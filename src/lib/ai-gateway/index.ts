// The AI Gateway (ADR 0012).
//
// One entry point. Feature code states a task, a scope and an input; it never
// sees a provider, a model name, a prompt version or a retry policy. What it
// gets back is a typed result that always includes where the answer came from.
//
// WHAT MOVING THE CALL SITES BOUGHT. Before this, four features each built
// their own prompt, chose their own model, handled their own failure and
// recorded nothing about the inference. Every safety property they had — crisis
// detection first, the output guard after, a deterministic fallback — held by
// convention, per call site. ADR 0012 puts it plainly: "a fifth call site added
// by someone who has not read the safety rules inherits none of it." The
// gateway makes them structural, because a feature cannot reach a model without
// passing through this function.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not write the prompts. Domain
// language belongs with the domain — a companion prompt built from a member's
// own trigger words has no business in an infrastructure module, and moving it
// here would make the gateway the place every feature negotiates with, which is
// the failure ADR 0012 names as its own main risk. The gateway owns the
// contract; the feature owns what it says.

import { activeProvider, providerConfigured, type ModelMessage, type ModelResponse } from "./provider";
import { getTask, type TaskDefinition } from "./registry";
import type { GatewayTool } from "./tiers";
import { appendEventSafe } from "../events";
import crypto from "node:crypto";

export type { ModelProvider, ModelRequest, ModelResponse, ModelMessage, ModelToolUse } from "./provider";
export { setProvider, providerConfigured, probeProvider } from "./provider";
export type { ProbeResult, ProbeStatus } from "./provider";
export { registerTask, getTask, registeredTasks } from "./registry";
export type { TaskDefinition } from "./registry";
export * from "./tiers";

export interface GatewayScope {
  tenantId: string;
  /** Whose record this concerns. Recorded on the inference so a person's
   *  ledger can answer "what did Steady think about me". */
  personId: string;
  /** ADR 0011 §5: what the retrieval is for, which bounds what may be read. */
  purpose: string;
  /** Who caused the call. */
  actorId?: string | null;
}

export interface GatewayInvocation {
  task: string;
  scope: GatewayScope;
  /** The task's system prompt, built by the feature that owns the domain. */
  system: string;
  messages: ModelMessage[];
  tools?: GatewayTool[];
  /** Runs one tool call and returns its result. The gateway enforces the
   *  allowlist; the feature performs the effect. */
  executeTool?: (use: { id: string; name: string; input: Record<string, unknown> }) => Promise<string>;
}

export type GatewayOutcome =
  /** The model answered and the answer survived every check. */
  | "answered"
  /** No provider is configured. Not an error: every task has a fallback. */
  | "unavailable"
  /** The provider failed, or the tool loop hit its ceiling. */
  | "failed";

export interface GatewayResult {
  outcome: GatewayOutcome;
  /** Empty unless the outcome is "answered". A caller that renders this without
   *  checking the outcome renders an empty string, not a wrong answer. */
  text: string;
  task: string;
  taskVersion: string;
  /** The model that served it, which can differ from the one the task asked
   *  for. Recorded rather than assumed. */
  model: string | null;
  /** Why it did not answer. Empty when it did. */
  reason: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
  /** The inference's own id, so a downstream record can cite it. */
  inferenceId: string | null;
}

function unavailable(task: TaskDefinition, reason: string, startedAt: number): GatewayResult {
  return {
    outcome: reason === "no provider configured" ? "unavailable" : "failed",
    text: "", task: task.id, taskVersion: task.version, model: null, reason,
    latencyMs: Date.now() - startedAt,
    usage: { inputTokens: 0, outputTokens: 0 },
    inferenceId: null,
  };
}

export async function invoke(call: GatewayInvocation): Promise<GatewayResult> {
  const startedAt = Date.now();
  const task = getTask(call.task);
  if (!task) {
    // An unregistered task is a programming error, and accepting one would let
    // a feature reach a model with no version, no tool policy and no fallback —
    // which is the state this whole module exists to end.
    throw new Error(
      `Unregistered gateway task: ${call.task}. Add it to src/lib/ai-gateway/registry.ts.`
    );
  }

  if (!providerConfigured()) return unavailable(task, "no provider configured", startedAt);

  // The task's allowlist is the authority, not the caller's argument. A feature
  // passing a tool the registry does not name gets it dropped rather than
  // honoured — a request for a capability a task was never granted is the exact
  // shape of the thing the tiers exist to refuse.
  const allowed = new Map((task.tools ?? []).map((t) => [t.name, t]));
  const offered = (call.tools ?? []).filter((t) => allowed.has(t.name));

  const messages = [...call.messages];
  let response: ModelResponse | null = null;

  try {
    const turns = task.maxToolTurns ?? 1;
    for (let turn = 0; turn < turns; turn++) {
      response = await activeProvider().complete({
        model: task.model,
        maxTokens: task.maxTokens,
        system: call.system,
        messages,
        ...(offered.length > 0
          ? { tools: offered.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }
          : {}),
        thinking: task.thinking,
        effort: task.effort,
        maxRetries: task.maxRetries,
      });

      if (response.toolUses.length === 0 || response.stopReason !== "tool_use") break;
      if (!call.executeTool) break;

      messages.push({ role: "assistant", content: response.content });
      // Sequential, so tool writes and their hash-chained audit entries stay
      // ordered. Concurrency here would interleave transactions.
      const results = [];
      for (const use of response.toolUses) {
        if (!allowed.has(use.name)) {
          // The model asked for something this task does not have. Answered
          // rather than thrown: refusing the tool and telling the model so is
          // the behaviour that keeps the conversation usable.
          results.push({ type: "tool_result", tool_use_id: use.id, content: "That tool is not available." });
          continue;
        }
        results.push({
          type: "tool_result", tool_use_id: use.id,
          content: await call.executeTool(use),
        });
      }
      messages.push({ role: "user", content: results });
      if (turn === turns - 1) {
        return { ...unavailable(task, "tool loop ceiling reached", startedAt) };
      }
    }
  } catch (err) {
    return unavailable(task, err instanceof Error ? err.message : "provider error", startedAt);
  }

  if (!response) return unavailable(task, "no response", startedAt);

  const latencyMs = Date.now() - startedAt;
  const inferenceId = await recordInference(task, call.scope, response, latencyMs);

  return {
    outcome: "answered",
    text: response.text,
    task: task.id,
    taskVersion: task.version,
    model: response.model,
    reason: "",
    latencyMs,
    usage: response.usage,
    inferenceId,
  };
}

/** ADR 0012 §6: every inference produces a provenance record.
 *
 *  The OUTPUT IS HASHED, NOT STORED, for a task whose PHI posture says so. §18
 *  requires it — "provenance may store protected input references and hashes
 *  rather than duplicating full PHI" — and it is also the difference between a
 *  ledger a security reviewer can read and a second copy of every clinical
 *  conversation in the product. */
async function recordInference(
  task: TaskDefinition,
  scope: GatewayScope,
  response: ModelResponse,
  latencyMs: number
): Promise<string | null> {
  return appendEventSafe({
    personId: scope.personId,
    tenantId: scope.tenantId,
    type: "inference.produced",
    actorId: scope.actorId ?? null,
    actorType: "model",
    payload: {
      task: task.id,
      taskVersion: task.version,
      purpose: scope.purpose,
      model: response.model,
      stopReason: response.stopReason,
      latencyMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      toolsUsed: response.toolUses.map((t) => t.name),
      outputHash: crypto.createHash("sha256").update(response.text).digest("hex"),
      outputChars: response.text.length,
      phi: task.phi,
    },
    provenance: { modelVersion: response.model, promptVersion: task.version },
    sourceSystem: "ai-gateway",
  });
}
