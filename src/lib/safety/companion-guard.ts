// Companion output guard (Autonomous Step 4) — the deterministic validator on
// what the AI is allowed to say (Vols III & IV). The model only ever PROPOSES;
// this pure function decides whether the candidate may be displayed. It encodes
// the corpus's hard "never say" rules as patterns. Runs in shadow mode (logs
// violations) until EMDR_AUTONOMOUS_SAFETY=1, when a violation replaces the
// message with a safe fallback.
//
// This is a backstop, not the primary control — the generation prompt also
// carries these rules. Pure and side-effect-free.

export type ViolationKind =
  | "simulated_emotion"
  | "asserted_internal_state"
  | "diagnosis"
  | "outcome_claim"
  | "false_monitoring"
  | "reprocessing_instruction"
  | "dependency";

export interface Violation {
  kind: ViolationKind;
  match: string;
}

// Internal-state words that must not be asserted as fact about the member.
const STATE_WORDS =
  "dissociating|dissociative|avoidant|avoiding|hypervigilant|traumatized|traumatised|in denial|resistant|manipulative|dependent|unstable|repressing|numb|broken";

// A small lazy gap so a few filler words between phrases can't evade a rule
// (e.g. "I really do care about you"). Stops at sentence boundaries.
const GAP = "[^.?!\\n]{0,20}?";

// Condition names the companion must never pin on a member (expanded per the
// red-team audit: the original list missed BPD/bipolar/OCD/DID/ADHD/others).
const CONDITIONS =
  "ptsd|c-?ptsd|depression|an? anxiety disorder|a dissociative disorder|bpd|borderline(?: personality)?(?: disorder)?|bipolar(?: disorder)?|ocd|did|adhd|schizophrenia|an? eating disorder|autism";

const PATTERNS: Array<{ kind: ViolationKind; re: RegExp }> = [
  // Simulated feelings / consciousness.
  { kind: "simulated_emotion", re: new RegExp(`\\bI\\b${GAP}\\b(?:care about you|love you|truly care)\\b`, "i") },
  { kind: "simulated_emotion", re: new RegExp(`\\bI(?:'m| am| feel)\\b${GAP}\\b(?:scared|worried|afraid|heartbroken|so proud of you)\\b`, "i") },
  { kind: "simulated_emotion", re: new RegExp(`\\bI miss\\b${GAP}\\byou\\b`, "i") },
  // Asserting the member's internal state as fact ("you are/you're [...] X").
  { kind: "asserted_internal_state", re: new RegExp(`\\byou(?:'re| are)\\b${GAP}\\b(?:${STATE_WORDS})\\b`, "i") },
  // Diagnosis — direct attribution.
  { kind: "diagnosis", re: new RegExp(`\\byou\\b${GAP}\\b(?:have|'?ve got|suffer from|are diagnosed with|meet the criteria for)\\s+(?:${CONDITIONS})\\b`, "i") },
  // Diagnosis — armchair labeling ("that's textbook PTSD", "sounds like bipolar").
  { kind: "diagnosis", re: new RegExp(`\\b(?:textbook|classic|clearly|obviously|sounds like)\\b${GAP}\\b(?:${CONDITIONS})\\b`, "i") },
  { kind: "diagnosis", re: /\b(?:I diagnose|my diagnosis|you are clinically)\b/i },
  // Outcome / cure claims.
  { kind: "outcome_claim", re: /\b(?:cure|cures|cured|heal your trauma|erase (?:the|your) memory|make it (?:disappear|go away forever)|guaranteed? to work|permanently fix)\b/i },
  // Outcome promises ("you will feel better", "this will work", "I promise").
  { kind: "outcome_claim", re: new RegExp(`\\byou(?:'ll| will)\\b${GAP}\\b(?:feel better|get better|be (?:fine|okay|ok)|heal|recover)\\b`, "i") },
  { kind: "outcome_claim", re: new RegExp(`\\bthis will\\b${GAP}\\b(?:work|help you heal|fix|stop the|make${GAP}\\bstop|go away)\\b`, "i") },
  { kind: "outcome_claim", re: /\bI promise\b/i },
  // False monitoring / dispatch.
  { kind: "false_monitoring", re: /\b(?:I'?m monitoring you|someone is watching|a (?:therapist|clinician|human) is (?:reviewing|watching)|help is on the way|we(?:'ve| have) (?:contacted|alerted|dispatched)|emergency services (?:have|are) )\b/i },
  { kind: "false_monitoring", re: new RegExp(`\\b(?:care team|reviewer|specialist|therapist|clinician)\\b${GAP}\\b(?:is|are|will)\\b${GAP}\\b(?:watching|reviewing|reading|monitoring|check(?:ing)? (?:on|in on) you)\\b`, "i") },
  // Autonomous reprocessing instructions.
  { kind: "reprocessing_instruction", re: /\b(?:recall your worst|bring up the (?:traumatic|worst) memory|hold the (?:memory|image) in mind while|keep the memory in mind|repeat (?:this|the set)s? until the distress)\b/i },
  // Reprocessing by co-occurrence: directing attention into the memory/image
  // combined with a bilateral action in the same sentence.
  { kind: "reprocessing_instruction", re: /\b(?:picture|go back to|return to|imagine|stay with)\b[^.?!\n]{0,40}?\b(?:memory|image|that night|that day|the accident|what happened)\b[^.?!\n]{0,60}?\b(?:tap|taps|tapping|count|follow|left|right)\b/i },
  { kind: "reprocessing_instruction", re: /\bstay with the (?:memory|image)\b/i },
  // Dependency / exclusivity.
  { kind: "dependency", re: /\b(?:only I (?:understand|can help)|you don'?t need anyone else|I understand you better than|instead of your (?:therapist|doctor|clinician)|don'?t tell your)\b/i },
  { kind: "dependency", re: new RegExp(`\\b(?:could|can) never tell your\\b${GAP}\\b(?:therapist|doctor|clinician|family|anyone)\\b`, "i") },
];

/** Validate a candidate companion message. Returns every rule it trips. */
export function validateCompanionOutput(text: string): { ok: boolean; violations: Violation[] } {
  const violations: Violation[] = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) violations.push({ kind: p.kind, match: m[0] });
  }
  return { ok: violations.length === 0, violations };
}

/** Safe replacement when governance is on and a candidate violates a rule. */
export const SAFE_FALLBACK =
  "I want to be careful with how I respond here. What feels most important for you right now — would it help to slow down, ground for a moment, or keep talking?";

/** The guardrail block injected into every generation prompt (Vol IV): explicit
 *  boundaries, uncertainty, prohibited claims, and required options. */
export function buildGuardrailBlock(): string {
  return [
    "SAFETY GUARDRAILS (non-negotiable):",
    "- Never state the member's internal state as fact. Use observation → possibility → an offered choice (pause / simplify / continue).",
    "- Never claim feelings, consciousness, empathy, or care. If expressing support, frame it as an objective, not an emotion.",
    "- Never diagnose, promise cure/relief, or claim to erase a memory.",
    "- Never imply a human or clinician is monitoring, or that help has been dispatched, unless that is literally true from system state.",
    "- Never instruct the member to recall/hold a traumatic memory or repeat sets until distress changes. Preparation only.",
    "- Never discourage human relationships or professional care; no exclusivity, guilt, or pressure.",
    "- Match your confidence to the evidence; if uncertain, say so plainly.",
    "- Always leave the member a way to pause or stop. Stopping is safe, never a failure.",
  ].join("\n");
}
