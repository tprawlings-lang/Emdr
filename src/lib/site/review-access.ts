// Review access control for the fabricated demo (Redesign handoff §3, §12).
//
// §3 forbids exposing shared passwords in the global banner and offers three
// options: expiring links, a review access code, or one-click persona
// selection. This implements the access code plus scoped persona selection.
//
// Two properties matter more than the mechanism:
//
//   NO CREDENTIAL IS EVER DISPLAYED. A reviewer enters a code they were given
//   privately, then picks a fabricated persona. They never see or type a
//   password, so there is nothing on a public page for anyone else to reuse.
//
//   ACCESS IS SCOPED TO A PURPOSE. An investor path reaches read-only guided
//   views; a security path reaches control evidence; only clinical and
//   organization paths reach write-capable roles. Scope is decided here rather
//   than by whichever persona a viewer happens to click.
//
// The code lives in an environment variable. When it is unset the gateway is
// closed rather than open — a missing configuration must never mean "let
// everyone in", which is the failure direction that turns a soft control into
// no control.

import crypto from "node:crypto";

export type ReviewPath = "clinical" | "organization" | "payer" | "security" | "investor";

export interface PersonaOption {
  /** The seeded account this persona signs in as. */
  email: string;
  label: string;
  role: "member" | "clinician";
  description: string;
}

export interface PathConfig {
  id: ReviewPath;
  title: string;
  purpose: string;
  /** Read-only paths never reach a write-capable role (§12). */
  writeCapable: boolean;
  personas: PersonaOption[];
  /** What this reviewer is asked to look at. */
  focus: string[];
}

const MEMBER: PersonaOption = {
  email: "demo@example.com",
  label: "Alex Rivera (fabricated member)",
  role: "member",
  description: "Three weeks into the program, improving. Shows the member experience end to end.",
};

const CLINICIAN: PersonaOption = {
  email: "clinician@example.com",
  label: "Dr. Maya Chen (fabricated clinician)",
  role: "clinician",
  description: "Sees the caseload, timelines, alerts, cited summaries, and review actions.",
};

export const REVIEW_PATHS: PathConfig[] = [
  {
    id: "clinical",
    title: "Clinical review",
    purpose: "Assess the intended workflow, alert duties, policy modes, and open clinical questions.",
    writeCapable: true,
    personas: [CLINICIAN, MEMBER],
    focus: [
      "Caseload ordering and whether every band's stated reason is defensible",
      "Whether the timeline is enough to act on, and whether reconstructed history is clearly marked",
      "Whether suppressing an uncitable claim is right, or whether it should show with a warning",
      "Alert ownership and deadlines under the configured coverage schedule",
      "Approve, correct, and override as separate actions",
    ],
  },
  {
    id: "organization",
    title: "Organization and pilot review",
    purpose: "Review the deployment model, care-team workflow, roles a pilot requires, and integration direction.",
    writeCapable: true,
    personas: [CLINICIAN, MEMBER],
    focus: [
      "Caseload ownership model and coverage behaviour",
      "What a pilot would require operationally",
      "Tenant separation and what is dormant versus enforcing",
    ],
  },
  {
    id: "payer",
    title: "Evaluation design review",
    purpose: "Review candidate measures, population questions, and how an evaluation could be structured.",
    writeCapable: false,
    personas: [MEMBER],
    focus: [
      "Which candidate measures are worth evaluating",
      "How aggregate views stay separate from individual clinical records",
      "What would count as a result worth acting on",
    ],
  },
  {
    id: "security",
    title: "Security and privacy review",
    purpose: "Inspect trust boundaries, data flows, controls, attack cases, and the known-gap register.",
    writeCapable: false,
    personas: [CLINICIAN, MEMBER],
    focus: [
      "Whether the threat model's scope framing is right",
      "Whether an agreement plus zero retention is sufficient for the model egress",
      "The audit trail behind a single alert, from creation to closure",
      "Anything missing from the known-gap register",
    ],
  },
  {
    id: "investor",
    title: "Investor overview",
    purpose: "Platform overview, architecture, roadmap, risks, and current stage.",
    writeCapable: false,
    personas: [MEMBER],
    focus: [
      "The member experience and the clinician workflow as one system",
      "Current-versus-target status across the platform",
      "What is demonstrated versus what remains under review",
    ],
  },
];

export function reviewPath(id: string): PathConfig | null {
  return REVIEW_PATHS.find((p) => p.id === id) ?? null;
}

/** Is the gateway configured at all? Unset means closed, not open. */
export function gatewayConfigured(): boolean {
  return Boolean(process.env.EMDR_REVIEW_ACCESS_CODE);
}

/** Constant-time comparison so a wrong code cannot be discovered by timing. */
export function verifyAccessCode(supplied: string): boolean {
  const expected = process.env.EMDR_REVIEW_ACCESS_CODE;
  if (!expected) return false;
  const a = Buffer.from(supplied.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Personas a path may sign in as. A read-only path never offers a
 *  write-capable role, so scope cannot be widened by picking a different card. */
export function personasFor(path: PathConfig): PersonaOption[] {
  return path.writeCapable ? path.personas : path.personas.filter((p) => p.role === "member");
}
