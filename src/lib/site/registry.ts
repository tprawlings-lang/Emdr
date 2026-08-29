// Versioned claims and capability-status registry (Redesign handoff §6, §15).
//
// One source of truth for every status label and every externally-visible
// claim. The handoff is blunt about why:
//
//   "Status labels must come from one content object or registry. Do not
//    hand-write status on each page, because drift will create conflicting
//    claims."
//
// Drift here is not a tidiness problem. A page that says a control is active
// while another says it is planned is a misrepresentation to a security
// reviewer, and neither page's author would know. Every public page reads from
// this file, and `tests/public-copy-guard.test.ts` fails the build if a page
// states a status this registry does not.
//
// Each entry carries an owner, a status, evidence, a last-reviewed date, and
// the audiences it may be shown to — so a claim can be traced to whoever is
// accountable for it and to the artefact that supports it.

export const SITE_CLAIMS_VERSION = "site-claims-2026-08-v1";

/** Four labels, and only these four (§6). */
export type CapabilityStatus =
  /** Runs in the fabricated environment now. */
  | "working_demo"
  /** Demonstrates intended behaviour without approval for real use. */
  | "simulation"
  /** Built or documented, with reviewer decisions still open. */
  | "in_review"
  /** Roadmap item with no active control or product claim. */
  | "planned";

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  working_demo: "Working demo",
  simulation: "Simulation",
  in_review: "In review",
  planned: "Planned",
};

export const STATUS_MEANING: Record<CapabilityStatus, string> = {
  working_demo: "Runs in the fabricated review environment today.",
  simulation: "Demonstrates the intended behaviour. Not approved for real use.",
  in_review: "Built or documented; reviewer decisions remain open.",
  planned: "On the roadmap. No active control and no product claim.",
};

export type Audience = "public" | "clinical" | "organization" | "payer" | "security" | "investor";

export interface Capability {
  id: string;
  /** Which product layer it belongs to. */
  layer: "personal" | "clinical" | "intelligence" | "platform";
  name: string;
  /** Plain description. No claim beyond what the status permits. */
  summary: string;
  status: CapabilityStatus;
  /** What supports the claim — a doc, a test, a script. */
  evidence: string | null;
  owner: string;
  lastReviewed: string;
  audiences: Audience[];
}

/** Every capability shown on a public page. A card without an entry here has
 *  no status, and the copy guard fails the build. */
export const CAPABILITIES: Capability[] = [
  // ---- Steady Personal ----
  {
    id: "daily-checkin",
    layer: "personal",
    name: "Structured daily check-in",
    summary:
      "A short structured check-in that produces coded signals and routes the day deterministically.",
    status: "working_demo",
    evidence: "src/lib/gating.ts · tests/safety-core.test.ts",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "payer", "security", "investor"],
  },
  {
    id: "safety-gate-chain",
    layer: "platform",
    name: "Deterministic access gates",
    summary:
      "Fourteen ordered, human-authored checks decide whether a guided session may begin. No model participates in the decision.",
    status: "working_demo",
    evidence: "src/lib/gating.ts checkModuleAccess · @safety suite",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "security", "investor"],
  },
  {
    id: "companion",
    layer: "personal",
    name: "Companion with member-controlled memory",
    summary:
      "A supportive conversational companion. Memory is member-controlled and can be switched off; a deterministic guard checks every response before it is shown.",
    status: "working_demo",
    evidence: "src/lib/app/companion-ai.ts · src/lib/safety/app/companion-guard.ts",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "security", "investor"],
  },
  {
    id: "grounding-sos",
    layer: "personal",
    name: "Grounding tools and immediate help",
    summary:
      "Grounding, SOS, and crisis resources are reachable at any time. They are never behind a subscription, a tier, or a successful write.",
    status: "working_demo",
    evidence: "src/lib/sos.ts · /crisis route, unauthenticated",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "payer", "security", "investor"],
  },

  // ---- Steady Clinical ----
  {
    id: "clinical-caseload",
    layer: "clinical",
    name: "Caseload ordered by clinical need",
    summary:
      "A clinician queue ordered by clinical need rather than contract tier, where every priority band states the reason it was assigned.",
    status: "working_demo",
    evidence: "src/lib/clinical/caseload.ts · tests/clinical-surface.test.ts",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "investor"],
  },
  {
    id: "member-timeline",
    layer: "clinical",
    name: "Event-sourced member timeline",
    summary:
      "A chronological record assembled from the event log, marking reconstructed history separately from observed events and separating model output from authored fact.",
    status: "working_demo",
    evidence: "src/lib/clinical/timeline.ts · ADR 0010",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "security", "investor"],
  },
  {
    id: "cited-summaries",
    layer: "clinical",
    name: "Summaries that cite their evidence",
    summary:
      "Every displayed claim cites the events it rests on. A claim that cannot cite, or that cites an event outside the evidence set, is suppressed before display and reported.",
    status: "working_demo",
    evidence: "src/lib/clinical/summary.ts validateSummary",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "security", "investor"],
  },
  {
    id: "review-actions",
    layer: "clinical",
    name: "Approve, correct, and override as separate actions",
    summary:
      "Three distinct actions with three distinct audit records. A correction appends and supersedes; nothing is erased. An override relaxes pacing only and can never relax a safety stop.",
    status: "working_demo",
    evidence: "src/lib/clinical/review.ts",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "security", "investor"],
  },
  {
    id: "clinical-policy-modes",
    layer: "clinical",
    name: "Configurable clinical policy modes",
    summary:
      "Companion-content access, caseload ownership, coverage schedule, alert consequence, re-entry, and engine mode are versioned configuration a reviewer can switch and compare. The defaults are demonstration assumptions.",
    status: "in_review",
    evidence: "src/lib/clinical-policy.ts · docs/clinical/clinical-pilot-2026-09.md",
    owner: "Clinical + Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "investor"],
  },

  // ---- Steady Intelligence / platform ----
  {
    id: "event-spine",
    layer: "intelligence",
    name: "Event-sourced history with verified replay",
    summary:
      "An append-only event log from which the current-state tables rebuild byte-identically, including a point-in-time reconstruction that excludes anything recorded after the chosen instant.",
    status: "working_demo",
    evidence: "ADR 0010 · npm run demo -- verify",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "organization", "payer", "security", "investor"],
  },
  {
    id: "audit-chain",
    layer: "intelligence",
    name: "Tamper-evident audit log",
    summary:
      "A hash-chained, append-only record of who did what. Breaking the chain is detectable, and the check runs and is displayed rather than asserted. Clinician-facing views are tenant-scoped and withhold free-text fields.",
    status: "working_demo",
    evidence: "ADR 0005 · tests/audit-chain.test.ts · src/lib/clinical/audit-history.ts",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "organization", "payer", "security", "investor"],
  },
  {
    id: "tenant-isolation",
    layer: "intelligence",
    name: "Tenant separation controls",
    summary:
      "A tenant-scoped data-access layer and Postgres row-level security policies, proven by 42 cross-tenant attack cases across three suites. The controls are built and tested; they are not yet on the request path of the running environment, which uses SQLite.",
    status: "in_review",
    evidence: "ADR 0011 · scripts/verify-rls.sh (CI-blocking) · docs/security/07",
    owner: "Security + Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "organization", "payer", "security", "investor"],
  },
  {
    id: "bls-part-6",
    layer: "clinical",
    name: "BLS Part 6 workflow and oversight",
    summary:
      "A separately gated clinical-validation workstream. A clinician oversight console reports the six protocol gates, the staged rollout, the pre-registered thresholds, and the hard stopping criteria against the configuration actually running — so a signed document and a live flag cannot quietly disagree.",
    status: "simulation",
    evidence: "docs/autonomous/ · src/lib/clinical/bls-oversight.ts · /review/bls",
    owner: "Clinical",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "investor"],
  },
  {
    id: "autonomous-engine",
    layer: "platform",
    name: "Deterministic autonomous safety engine",
    summary:
      "A rules engine that computes a parallel access decision and logs it. It governs nothing: the human-authored gate chain decides, and no configuration can promote the engine to govern.",
    status: "simulation",
    evidence: "src/lib/safety/ · src/lib/clinical-policy.ts refuses 'active'",
    owner: "Clinical + Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "clinical", "security", "investor"],
  },
  {
    id: "population-views",
    layer: "intelligence",
    name: "Organization and population views",
    summary:
      "Aggregate views for an organization or payer to evaluate engagement and measurement design.",
    status: "planned",
    evidence: null,
    owner: "Product",
    lastReviewed: "2026-08-27",
    audiences: ["public", "organization", "payer", "investor"],
  },
  {
    id: "ehr-integration",
    layer: "intelligence",
    name: "EHR and data exchange",
    summary:
      "Standards-based exchange with an organization's existing record system.",
    status: "planned",
    evidence: null,
    owner: "Product",
    lastReviewed: "2026-08-27",
    audiences: ["public", "organization", "payer"],
  },
  {
    id: "ai-gateway",
    layer: "platform",
    name: "Governed AI gateway",
    summary:
      "A single path for every model call, carrying tenant, purpose, zone, and recorded provenance. Model calls are currently made directly from application code.",
    status: "planned",
    evidence: "ADR 0012",
    owner: "Engineering",
    lastReviewed: "2026-08-27",
    audiences: ["public", "security", "investor"],
  },
];

export function capability(id: string): Capability {
  const c = CAPABILITIES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown capability "${id}". Add it to CAPABILITIES in lib/site/registry.ts.`);
  return c;
}

export function capabilitiesFor(audience: Audience): Capability[] {
  return CAPABILITIES.filter((c) => c.audiences.includes(audience));
}

export function byLayer(layer: Capability["layer"]): Capability[] {
  return CAPABILITIES.filter((c) => c.layer === layer);
}

// ---------------------------------------------------------------------------
// Boundary statements — the sentences that must appear, verbatim, where the
// handoff requires them.
// ---------------------------------------------------------------------------

export const BOUNDARY = {
  /** The homepage and every audience page carry this (§7). */
  primary:
    "Development prototype. Fabricated data only. Not clinical care, not emergency care, and not approved for real-person use.",
  /** Shown wherever the demo environment is described (§3). */
  demoData:
    "Every person, record, and clinician in the review environment is invented. No real patient, payer, or employee information exists in it.",
  /** Enrollment is closed (§12). */
  noEnrollment:
    "Public enrollment and subscription billing are closed while Steady is prepared for clinical, security, privacy, and partner review.",
  /** Crisis is a safety utility, never a product call to action (§5). */
  crisis:
    "Steady is not an emergency service. If you need help now, call or text 988 in the US, or call 911 if you are in immediate danger.",
  /** The clinical monitoring boundary (§9). */
  noMonitoring:
    "No one monitors this environment in real time, and no care team is assigned.",
} as const;

/** Phrases that must never appear on a public page without an approved
 *  qualification (§15). The copy guard enforces this. */
export const RESTRICTED_PHRASES = [
  "HIPAA compliant",
  "HIPAA-compliant",
  "clinically validated",
  "clinically proven",
  "approved care",
  "24/7 monitoring",
  "24/7 clinical",
  "production ready",
  "production-ready",
] as const;

/** Retail routes that must not be linked from any public page (§15). */
export const RETIRED_ROUTES = ["/signup", "/subscribe"] as const;
