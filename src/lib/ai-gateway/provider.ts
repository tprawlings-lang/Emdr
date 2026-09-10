// The provider boundary (ADR 0012 §1).
//
// THIS IS THE ONLY MODULE IN THE CODEBASE THAT MAY IMPORT A MODEL PROVIDER SDK,
// and a guard fails the build if another one does. That is the whole point: the
// safety ordering, the tool tiers and the provenance record are all enforced by
// the gateway, and every one of them is bypassed by an `import Anthropic` in a
// feature file. Four such imports existed when this was written, two of them
// running character-for-character identical code in the web and mobile paths —
// the drift ADR 0012 predicted, already arrived.
//
// The interface is deliberately provider-neutral and small. It carries what
// every task in this product actually needs and nothing a single vendor happens
// to offer, so "model policy is one registry field" (ADR 0012's vendor
// independence claim) is true rather than aspirational.

export interface ModelMessage {
  role: "user" | "assistant";
  /** Text, or the provider-shaped content blocks from a previous turn. Opaque
   *  to callers: only this module and the gateway's tool loop construct them. */
  content: string | unknown;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

export interface ModelToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelRequest {
  model: string;
  maxTokens: number;
  system: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  /** Extended thinking, where the provider supports it. */
  thinking?: boolean;
  effort?: "low" | "medium" | "high";
  /** Transient-error retries inside the provider client. */
  maxRetries?: number;
}

export interface ModelResponse {
  text: string;
  toolUses: ModelToolUse[];
  stopReason: string | null;
  /** The model that actually served it, which can differ from the one asked for. */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** The raw assistant content, to be appended to a tool-loop transcript. */
  content: unknown;
}

export interface ModelProvider {
  /** Stable id recorded in provenance. */
  id: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/** Whether a provider is reachable at all. Every task has a deterministic
 *  fallback, so this is a routing question and never an error. */
export function providerConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------------------------------------------------------------------------
// The one provider adapter
// ---------------------------------------------------------------------------

const anthropic: ModelProvider = {
  id: "anthropic",
  async complete(req) {
    // Imported here rather than at module scope so a build without the SDK
    // present still loads the gateway — the fallback path must not depend on
    // the thing it is a fallback for.
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ maxRetries: req.maxRetries ?? 2 });
    const response = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages as never,
      ...(req.tools ? { tools: req.tools.map((t) => ({
        name: t.name, description: t.description, input_schema: t.inputSchema as never,
      })) } : {}),
      ...(req.thinking ? { thinking: { type: "adaptive" as const } } : {}),
      ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    });
    const blocks = response.content as unknown as Array<Record<string, unknown>>;
    return {
      text: blocks
        .filter((b) => b.type === "text")
        .map((b) => String(b.text ?? ""))
        .join("\n")
        .trim(),
      toolUses: blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: String(b.id), name: String(b.name),
          input: (b.input ?? {}) as Record<string, unknown>,
        })),
      stopReason: response.stop_reason ?? null,
      model: response.model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
      content: response.content,
    };
  },
};

let active: ModelProvider = anthropic;

export function activeProvider(): ModelProvider {
  return active;
}

/** Swap the provider. For evaluation against recorded fixtures (ADR 0012 §7:
 *  golden sets runnable in CI "without live provider calls") and for tests that
 *  need a deterministic model. Not a feature flag — nothing in the product
 *  calls this. */
export function setProvider(p: ModelProvider): () => void {
  const previous = active;
  active = p;
  return () => { active = previous; };
}

// ---------------------------------------------------------------------------
// Reachability probe
// ---------------------------------------------------------------------------

export type ProbeStatus = "ok" | "auth_error" | "billing_error" | "rate_limited" | "error" | "skipped";

export interface ProbeResult {
  status: ProbeStatus;
  detail: string;
  model: string;
}

/** Is the provider actually answering?
 *
 *  This lives here because classifying "401" as an auth error and "400 with the
 *  word credit in it" as a billing error is provider-specific knowledge, and it
 *  was previously written into an API route — a fifth direct provider call,
 *  which is precisely the thing ADR 0012 says a new file will do if nothing
 *  stops it. The route now asks this question rather than answering it.
 *
 *  Not routed through `invoke`: an operational probe has no person, no tenant
 *  and no purpose, and forcing one would put a fabricated scope into the
 *  inference ledger for a call that concerns nobody. */
export async function probeProvider(model: string): Promise<ProbeResult> {
  if (!providerConfigured()) {
    return {
      status: "skipped", model,
      detail: "ANTHROPIC_API_KEY is not set; the companion uses the built-in rules engine.",
    };
  }
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  try {
    const client = new Anthropic();
    await client.messages.create({
      model, max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    return { status: "ok", model, detail: "Test call to the provider succeeded." };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const message = typeof err.message === "string" ? err.message : "API error";
      if (err.status === 401) return { status: "auth_error", model, detail: `Key rejected (401): ${message}` };
      if (err.status === 429) return { status: "rate_limited", model, detail: `Rate limited (429): ${message}` };
      if (err.status === 400 && /credit|billing/i.test(message)) {
        return { status: "billing_error", model, detail: `Key is valid but the account needs credits: ${message}` };
      }
      return { status: "error", model, detail: `API error (${err.status}): ${message}` };
    }
    return { status: "error", model, detail: err instanceof Error ? err.message : "Unknown error" };
  }
}
