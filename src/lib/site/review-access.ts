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
  /** What this reviewer is asked to look at, and where to go to look.
   *
   *  These were plain strings shown once on the gateway and then forgotten,
   *  which made them a reading list rather than a route. A reviewer who has to
   *  reconstruct "where was the alert trail again?" from memory is doing
   *  navigation work instead of review work. */
  focus: Array<{ label: string; href: string }>;
}

const MEMBER: PersonaOption = {
  email: "patient.demo@steady.local",
  label: "Alex Rivera (fabricated member)",
  role: "member",
  description: "Three weeks into the program, improving. Shows the member experience end to end.",
};

const CLINICIAN: PersonaOption = {
  email: "clinician.demo@steady.local",
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
      { label: "Caseload ordering — is every band's stated reason defensible?", href: "/clinician/caseload" },
      { label: "The trajectory — is it enough to act on, and is reconstructed history clearly marked?", href: "/clinician/caseload" },
      { label: "Suppressed claims — right to hide them, or should they show with a warning?", href: "/clinician/caseload" },
      { label: "Alert deadlines under the configured coverage schedule", href: "/clinician/caseload" },
      { label: "Approve, correct, and override as three separate actions", href: "/clinician/caseload" },
      { label: "BLS Part 6 gates and what is actually running", href: "/review/bls" },
      { label: "Tell us what you would change", href: "/review/testing" },
    ],
  },
  {
    id: "organization",
    title: "Organization and pilot review",
    purpose: "Review the deployment model, care-team workflow, roles a pilot requires, and integration direction.",
    writeCapable: true,
    personas: [CLINICIAN, MEMBER],
    focus: [
      { label: "Caseload ownership model and coverage behaviour", href: "/clinician/caseload" },
      { label: "What a pilot would require operationally", href: "/organizations" },
      { label: "Tenant separation — what is enforcing and what is dormant", href: "/trust" },
      { label: "Tell us what you would change", href: "/review/testing" },
    ],
  },
  {
    id: "payer",
    title: "Evaluation design review",
    purpose: "Review candidate measures, population questions, and how an evaluation could be structured.",
    writeCapable: false,
    personas: [MEMBER],
    focus: [
      { label: "Which candidate measures are worth evaluating", href: "/payers" },
      { label: "What the platform can actually measure today", href: "/evidence" },
      { label: "What would count as a result worth acting on", href: "/payers" },
    ],
  },
  {
    id: "security",
    title: "Security and privacy review",
    purpose: "Inspect trust boundaries, data flows, controls, attack cases, and the known-gap register.",
    writeCapable: false,
    personas: [CLINICIAN, MEMBER],
    focus: [
      { label: "Control status — what is current, dormant, and planned", href: "/trust" },
      { label: "The known-gap register — anything missing?", href: "/trust" },
      { label: "The audit trail behind a single alert, creation to closure", href: "/review/audit" },
      { label: "Runnable evidence — the commands, not the claims", href: "/evidence" },
    ],
  },
  {
    id: "investor",
    title: "Investor overview",
    purpose: "Platform overview, architecture, roadmap, risks, and current stage.",
    writeCapable: false,
    personas: [MEMBER],
    focus: [
      { label: "The member experience — start here", href: "/app/today" },
      { label: "The clinician workflow reading the same events", href: "/clinician/caseload" },
      { label: "Current versus target across the platform", href: "/platform" },
      { label: "What is demonstrated versus what remains under review", href: "/evidence" },
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
