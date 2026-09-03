// Tool risk tiers (ADR 0012 §4).
//
// The prohibited tier is the reason this file exists. A6's boundary —
// "generative output cannot override a safety state" — held in this codebase
// because nobody had defined such a tool. That is a true statement about the
// present and no guarantee about the future: the invariant lived in an absence,
// and an absence cannot refuse anything.
//
// Under the gateway it is refused structurally. A task may only offer tools its
// registry entry allows, every tool must carry a tier, and a tool whose name
// matches a prohibited capability is rejected at registration rather than at
// the call — so the failure happens when somebody writes it, not when a model
// decides to use it.

export type ToolTier =
  /** Retrieval only. No write of any kind. */
  | "read"
  /** Patient-owned and reversible by the patient. */
  | "write-soft"
  /** Enters the clinical record. Requires a human decision before it lands. */
  | "write-clinical"
  /** Raises protection and can never lower it: notifying a care team, opening
   *  an alert, routing to crisis.
   *
   *  ITS OWN TIER BECAUSE THE OTHERS WOULD BE WRONG. ADR 0012 lists four, and
   *  `escalate_risk` — the companion's tool for "the member says they are not
   *  safe" — fits none of them. It is not patient-owned or reversible, so it is
   *  not write-soft. It enters the clinical record, so write-clinical is the
   *  near fit, and write-clinical requires a human decision BEFORE the action
   *  lands. Making a suicide-risk alert wait for a human to confirm it is the
   *  harm, not the safeguard.
   *
   *  So the rule for this tier is the opposite one: it never waits, and it is
   *  admissible only for an action that cannot reduce anyone's protection. A
   *  tool that could both raise and lower is not this tier. */
  | "safety-escalation"
  /** Never model-invokable, at any tier, under any flag. */
  | "prohibited";

/** What no model may ever do, by capability rather than by tool name — a rename
 *  must not be a way through. Each entry is matched against a tool's declared
 *  capability, which is a required field precisely so this list can be applied. */
export const PROHIBITED_CAPABILITIES = [
  "clear_safety_state",
  "unlock_gated_pathway",
  "change_permissions",
  "erase_history",
  "diagnose",
  "override_clinician_decision",
] as const;

export type ProhibitedCapability = (typeof PROHIBITED_CAPABILITIES)[number];

export interface GatewayTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  tier: ToolTier;
  /** What the tool does, in the vocabulary the prohibited list is written in.
   *  Required: a tool with no stated capability cannot be checked against the
   *  list, and "unchecked" would quietly become "allowed". */
  capability: string;
}

export class ProhibitedToolError extends Error {}

/** Called at registration, not at invocation. A tool that must never exist
 *  should fail the build, not the request. */
export function assertToolAllowed(tool: GatewayTool, taskId: string): void {
  if (tool.tier === "prohibited") {
    throw new ProhibitedToolError(
      `Task ${taskId} offers tool ${tool.name}, which is declared prohibited.`
    );
  }
  if ((PROHIBITED_CAPABILITIES as readonly string[]).includes(tool.capability)) {
    throw new ProhibitedToolError(
      `Task ${taskId} offers tool ${tool.name} with capability "${tool.capability}", ` +
      `which no model may invoke at any tier.`
    );
  }
}
