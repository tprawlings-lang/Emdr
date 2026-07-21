// Companion memory model (Autonomous Step 4) — the 6-class taxonomy, provenance,
// graceful decay, and retrieval gates from Volumes IV & V.
//
// Pure and side-effect-free. Maps the existing ai_memory_items types onto the
// clinician's memory classes and their governance. TTLs are PROVISIONAL pending
// sign-off; the STRUCTURE (classes, provenance, gates) is the point.

/** Vol V Ch.7 memory classes — each has distinct governance. */
export enum MemoryClass {
  Account = "account", // auth/eligibility — never exposed to the model
  Educational = "educational", // learning progress, focus areas
  Preference = "preference", // how the member wants to be supported
  Procedural = "procedural", // workflow rules ("don't raise X")
  Provider = "provider", // provider-authored instructions
  SafetyAudit = "safety_audit", // policy activations, risk events
}

/** Provenance every memory carries (Vol IV). "A memory without provenance is
 *  difficult to challenge." */
export interface Provenance {
  source: string;
  /** The member explicitly said this (vs. the system inferred it). */
  userStated: boolean;
  /** Categorical confidence — no false-precision numbers. */
  confidence: "low" | "moderate" | "high" | "confirmed";
  createdAtMs: number;
  lastConfirmedAtMs: number | null;
  /** Whether this memory may EVER influence a safety decision (default false). */
  mayInfluenceSafety: boolean;
  /** Whether the member has chosen to share this with a provider. */
  sharedWithProvider: boolean;
}

const SENSITIVE_TYPES = new Set(["trigger", "session_pattern", "safety"]);

/** Provisional TTL for sensitive episodic memory (auto-expires unless pinned). */
export const SENSITIVE_EPISODIC_TTL_DAYS = 180;

export interface ClassifiedMemory {
  memoryClass: MemoryClass;
  sensitive: boolean;
}

/** Map an existing ai_memory_items (type, source) to its class + sensitivity. */
export function classifyMemory(memoryType: string, sourceType: string): ClassifiedMemory {
  const sensitive = SENSITIVE_TYPES.has(memoryType);
  if (sourceType === "specialist_note") return { memoryClass: MemoryClass.Provider, sensitive };
  switch (memoryType) {
    case "safety":
      return { memoryClass: MemoryClass.SafetyAudit, sensitive: true };
    case "tone_preference":
      return { memoryClass: MemoryClass.Preference, sensitive: false };
    case "restricted_topic":
      return { memoryClass: MemoryClass.Procedural, sensitive: false };
    default:
      // trigger / grounding_tool / readiness / session_pattern / progress_pattern
      // / focus_area → educational (some sensitive).
      return { memoryClass: MemoryClass.Educational, sensitive };
  }
}

export interface DecayInput {
  memoryClass: MemoryClass;
  sensitive: boolean;
  createdAtMs: number;
  /** Member deliberately preserved this. */
  pinned?: boolean;
  /** Provider relationship still active (for Provider-class memory). */
  providerActive?: boolean;
}

/** Graceful forgetting (Vol IV). Returns whether the memory is still active or
 *  should be treated as expired at `nowMs`. */
export function decayState(m: DecayInput, nowMs: number): "active" | "expired" {
  switch (m.memoryClass) {
    case MemoryClass.Preference:
    case MemoryClass.Procedural:
    case MemoryClass.SafetyAudit:
      // Retained (preferences editable; safety/audit outlives personalization).
      return "active";
    case MemoryClass.Provider:
      // Provider instruction without an active relationship should not persist.
      return m.providerActive === false ? "expired" : "active";
    case MemoryClass.Account:
      return "active";
    case MemoryClass.Educational:
    default:
      // Sensitive episodic auto-expires unless the member pinned it.
      if (m.sensitive && !m.pinned) {
        const ageDays = (nowMs - m.createdAtMs) / (24 * 3600 * 1000);
        return ageDays > SENSITIVE_EPISODIC_TTL_DAYS ? "expired" : "active";
      }
      return "active";
  }
}

// ── Retrieval gates (retrieval policy ≠ storage policy, Vol IV) ──────────────

/** Whether a memory may be placed into the model's context. Account and
 *  Safety/Audit memory are never fed to the companion as chat context. */
export function canExposeToModel(memoryClass: MemoryClass): boolean {
  return memoryClass !== MemoryClass.Account && memoryClass !== MemoryClass.SafetyAudit;
}

/** Whether a memory may be shared with a provider (requires the member's
 *  explicit per-item share choice AND an active provider relationship). */
export function canShareWithProvider(p: Provenance, providerActive: boolean): boolean {
  return p.sharedWithProvider === true && providerActive === true;
}

/** Whether a memory may influence a SAFETY decision. Only member-stated,
 *  explicitly-safety-relevant memory qualifies — inferred memory never does. */
export function canInfluenceSafety(p: Provenance): boolean {
  return p.mayInfluenceSafety === true && p.userStated === true;
}
