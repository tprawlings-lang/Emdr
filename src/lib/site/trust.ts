// Trust Center and Evidence content (Redesign handoff §11).
//
// "These pages should earn confidence through precision. They should not read
//  like security or clinical certification pages."
//
// So this file holds facts with owners and dates, not reassurance. It mirrors
// docs/security/ — the same findings, the same statuses, the same gaps — rather
// than paraphrasing them into something friendlier. Where the two ever
// disagree, the security package is the source and this file is the bug.
//
// Control status uses three words deliberately: CURRENT (enforcing today),
// DORMANT (built and tested, not on the request path), PLANNED (no control
// exists). "Dormant" is the one that matters most: it is the honest word for
// a control that would pass a code review and protect nobody.

export type ControlState = "current" | "dormant" | "planned";

export const CONTROL_STATE_LABEL: Record<ControlState, string> = {
  current: "Current",
  dormant: "Dormant",
  planned: "Planned",
};

export const CONTROL_STATE_MEANING: Record<ControlState, string> = {
  current: "Enforcing in the running environment today.",
  dormant: "Built and tested, but not on the request path of the running environment.",
  planned: "No control exists yet.",
};

export interface Control {
  id: string;
  area: string;
  name: string;
  state: ControlState;
  detail: string;
  evidence: string | null;
  owner: string;
}

export const CONTROLS: Control[] = [
  // ---- Identity and access ----
  {
    id: "session",
    area: "Identity and access",
    name: "Stateless signed sessions",
    state: "current",
    detail:
      "HMAC-SHA256 cookie, httpOnly and SameSite, with an idle expiry and a 30-day absolute cap. Revocation is per account via a token epoch.",
    evidence: "ADR 0006",
    owner: "Engineering",
  },
  {
    id: "mfa",
    area: "Identity and access",
    name: "Multi-factor authentication",
    state: "planned",
    detail:
      "No MFA exists for any role. For a clinician-facing surface this is the notable gap: a password is currently the only barrier to every member record in the environment.",
    evidence: null,
    owner: "Engineering",
  },
  {
    id: "caseload-scoping",
    area: "Identity and access",
    name: "Caseload scoping for clinicians",
    state: "planned",
    detail:
      "A clinician account can read every member in the environment. Acceptable for a single-tenant prototype holding fabricated data; not acceptable for a pilot.",
    evidence: null,
    owner: "Engineering + Clinical",
  },

  // ---- Tenancy ----
  {
    id: "repo-layer",
    area: "Tenancy",
    name: "Tenant-scoped data-access layer",
    state: "dormant",
    detail:
      "A repository that cannot be constructed without a tenant context and adds the tenant predicate to every statement. Built and adversarially tested; product call sites have not been migrated behind it.",
    evidence: "ADR 0011 · tests/tenant-isolation.test.ts (18 cases)",
    owner: "Engineering",
  },
  {
    id: "tenant-tx",
    area: "Tenancy",
    name: "Tenant-bound transactions",
    state: "dormant",
    detail:
      "A transaction binds to exactly one tenant and sets the database session variable the row-level policies test. A nested call naming a different tenant throws.",
    evidence: "tests/tenant-transaction.test.ts (12 cases)",
    owner: "Engineering",
  },
  {
    id: "rls",
    area: "Tenancy",
    name: "Postgres row-level security",
    state: "dormant",
    detail:
      "Policies enabled and forced on every table carrying a tenant column, generated from the system catalog so a new table cannot be added unprotected. Dormant because the running environment uses SQLite.",
    evidence: "scripts/pg-schema.sql · npm run test:rls (12 attack cases, CI-blocking)",
    owner: "Security",
  },
  {
    id: "cross-tenant",
    area: "Tenancy",
    name: "Cross-tenant access as a role, not a flag",
    state: "dormant",
    detail:
      "Platform administration is a database role the application role cannot assume, so an application-layer compromise cannot grant itself the policy by setting a variable. Every use is audited with its stated reason.",
    evidence: "scripts/verify-rls.sh",
    owner: "Security",
  },

  // ---- Data protection ----
  {
    id: "field-encryption",
    area: "Data protection",
    name: "Application-layer field encryption",
    state: "current",
    detail:
      "AES-256-GCM on free-text fields. This protects data at rest and in backups. It does not protect content sent to the model provider, which is decrypted by definition.",
    evidence: "ADR 0002",
    owner: "Engineering",
  },
  {
    id: "key-custody",
    area: "Data protection",
    name: "Separated key custody",
    state: "planned",
    detail:
      "The encryption key and the session secret currently sit in the same environment as the data they protect. A single environment disclosure yields both the ability to decrypt and the ability to impersonate.",
    evidence: null,
    owner: "Operations",
  },
  {
    id: "backups",
    area: "Data protection",
    name: "Encrypted backups",
    state: "current",
    detail:
      "Scheduled backups encrypted before upload, with failure alerting. Restore has not been rehearsed against a production-shaped dataset.",
    evidence: "docs/backups.md",
    owner: "Operations",
  },

  // ---- History and audit ----
  {
    id: "audit",
    area: "History and audit",
    name: "Tamper-evident audit log",
    state: "current",
    detail:
      "Hash-chained and append-only across eight event families. Breaking the chain is detectable. It records what was done, not what was seen — read auditing does not exist yet.",
    evidence: "ADR 0005 · tests/audit-chain.test.ts",
    owner: "Engineering",
  },
  {
    id: "event-spine",
    area: "History and audit",
    name: "Append-only event history with verified replay",
    state: "current",
    detail:
      "Current-state tables rebuild byte-identically from the event log, including a point-in-time reconstruction that excludes anything recorded after the chosen instant.",
    evidence: "ADR 0010 · npm run demo -- verify",
    owner: "Engineering",
  },
  {
    id: "immutability-privilege",
    area: "History and audit",
    name: "Immutability at the privilege level",
    state: "dormant",
    detail:
      "On Postgres the application role is granted only SELECT and INSERT on the event and audit logs, so append-only survives an application bug. Dormant with the rest of the Postgres work.",
    evidence: "scripts/pg-schema.sql",
    owner: "Security",
  },
  {
    id: "db-access-audit",
    area: "History and audit",
    name: "Database-level access auditing",
    state: "planned",
    detail:
      "An operator reading rows directly bypasses the application and leaves no application trail.",
    evidence: null,
    owner: "Operations + Security",
  },

  // ---- AI ----
  {
    id: "output-guard",
    area: "AI",
    name: "Deterministic output guard",
    state: "current",
    detail:
      "Every model response is validated before display. Crisis routing is deterministic and never model-decided.",
    evidence: "src/lib/safety/companion-guard.ts",
    owner: "Engineering",
  },
  {
    id: "citation-contract",
    area: "AI",
    name: "Citation contract on clinical summaries",
    state: "current",
    detail:
      "A claim with no citation, or citing an event outside the evidence set, is suppressed before display and reported. Enforced by a validator independent of the generator.",
    evidence: "src/lib/clinical/summary.ts",
    owner: "Engineering",
  },
  {
    id: "kill-switches",
    area: "AI",
    name: "Capability kill switches",
    state: "current",
    detail:
      "Generative responses, bilateral stimulation, escalation, provider sharing, and new sessions can each be disabled by configuration. None can disable crisis resources.",
    evidence: "docs/incident-response.md",
    owner: "Engineering",
  },
  {
    id: "ai-gateway",
    area: "AI",
    name: "Governed AI gateway",
    state: "planned",
    detail:
      "Model calls are made directly from application code, so purpose and zone scoping hold by construction rather than by enforcement, and no per-inference provenance record exists.",
    evidence: "ADR 0012",
    owner: "Engineering",
  },

  // ---- Web ----
  {
    id: "headers",
    area: "Web",
    name: "Security headers and nonce-based CSP",
    state: "current",
    detail:
      "HSTS with includeSubDomains, a per-response nonce CSP with no unsafe-inline for scripts, frame denial, and a referrer policy. Asserted on every response by the end-to-end suite.",
    evidence: "ADR 0008 · tests/e2e/smoke.spec.ts",
    owner: "Engineering",
  },
  {
    id: "rate-limit",
    area: "Web",
    name: "Rate limiting on the model endpoint",
    state: "current",
    detail:
      "An in-process limiter protects the paid endpoint from cost abuse. It is per-process and would not survive a multi-instance deployment.",
    evidence: "src/lib/rate-limit.ts",
    owner: "Engineering",
  },
];

export function controlsByArea(): Record<string, Control[]> {
  const out: Record<string, Control[]> = {};
  for (const c of CONTROLS) (out[c.area] ??= []).push(c);
  return out;
}

// ---------------------------------------------------------------------------
// Known gaps (§11: "named findings, owner, target tier, mitigation, acceptance test")
// ---------------------------------------------------------------------------

export interface Gap {
  id: string;
  finding: string;
  risk: "high" | "medium";
  owner: string;
  /** The tier this must be closed before. */
  targetTier: "T1" | "T2" | "T3";
  mitigation: string;
  acceptance: string;
}

/** Mirrors the ranked findings in docs/security/README.md. Given to reviewers
 *  rather than left for them to find — a gap we disclose is a gap we understand. */
export const KNOWN_GAPS: Gap[] = [
  {
    id: "model-baa",
    finding:
      "No business associate agreement with the model provider, which receives the full decrypted conversation transcript along with model-exposable memories and profile context.",
    risk: "high",
    owner: "Founder + Counsel",
    targetTier: "T2",
    mitigation:
      "The environment contains fabricated data only, so no real person's content has been sent.",
    acceptance: "Executed agreement with zero or minimal retention and no training on submitted content.",
  },
  {
    id: "tenant-path",
    finding:
      "Tenant isolation controls are built and adversarially tested but are not on the request path. Product code reaches the database directly.",
    risk: "high",
    owner: "Engineering",
    targetTier: "T2",
    mitigation: "One tenant exists in the running environment, so there is no second tenant to cross into.",
    acceptance: "No product write reaches the data layer outside a tenant-bound transaction, enforced by test.",
  },
  {
    id: "key-custody",
    finding:
      "The encryption key and session secret are co-located in the application environment with the data they protect.",
    risk: "high",
    owner: "Operations",
    targetTier: "T2",
    mitigation: "Fabricated data only; keys are not shared outside the deployment.",
    acceptance: "Neither key is readable from the application environment at rest, and rotation has been rehearsed.",
  },
  {
    id: "restore",
    finding: "Backup restore has never been rehearsed against a production-shaped dataset.",
    risk: "high",
    owner: "Operations",
    targetTier: "T2",
    mitigation: "Backups are running and encrypted; failure alerting is active.",
    acceptance: "A restore completes and the audit chain verifies afterwards.",
  },
  {
    id: "clinician-scope",
    finding: "A clinician account can read every member in the environment; caseload scoping does not exist.",
    risk: "high",
    owner: "Engineering + Clinical",
    targetTier: "T2",
    mitigation: "All records are fabricated, and the clinician role is issued only to named reviewers.",
    acceptance: "An out-of-caseload request returns not-found and is audited.",
  },
  {
    id: "erasure",
    finding:
      "Append-only history is in tension with erasure rights. What consent withdrawal deletes, tombstones, or retains is undecided.",
    risk: "high",
    owner: "Counsel + Engineering",
    targetTier: "T2",
    mitigation: "No real person's data exists, so no erasure right is currently owed.",
    acceptance: "A written determination, then a tested implementation.",
  },
  {
    id: "branch-protection",
    finding: "The default branch is unprotected, so unreviewed code can reach the deployment.",
    risk: "high",
    owner: "Founder",
    targetTier: "T1",
    mitigation: "Continuous integration gates run on every push and block on failure.",
    acceptance: "Branch protection requires pull requests and passing checks.",
  },
  {
    id: "operator-audit",
    finding: "Direct database access by an operator bypasses the application and leaves no application audit trail.",
    risk: "medium",
    owner: "Operations + Security",
    targetTier: "T2",
    mitigation: "Access to the deployment is limited to the founder.",
    acceptance: "Direct reads appear in a log the application cannot alter.",
  },
  {
    id: "rate-limit-scale",
    finding: "Rate limiting is per-process and would not hold across a multi-instance deployment.",
    risk: "medium",
    owner: "Engineering",
    targetTier: "T3",
    mitigation: "The environment runs as a single instance.",
    acceptance: "The limit holds across two instances under load.",
  },
  {
    id: "coerced-access",
    finding:
      "A member whose device or account is controlled by someone else has no protection. Trigger maps and safety plans name the person they are escaping.",
    risk: "medium",
    owner: "Product + Clinical",
    targetTier: "T2",
    mitigation: "No real member exists in the environment.",
    acceptance: "Reviewed by clinical reviewers as part of the pilot packet.",
  },
];

// ---------------------------------------------------------------------------
// Evidence (§11 evidence page structure)
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  claim: string;
  support: string;
  runnable: string | null;
}

export const EVIDENCE_METHOD: EvidenceItem[] = [
  {
    claim: "EMDR delivered by trained clinicians has published support for post-traumatic stress.",
    support:
      "Published research and clinical practice guidelines describe clinician-delivered EMDR. This is evidence about the method as practised by clinicians.",
    runnable: null,
  },
  {
    claim: "That evidence does not transfer to Steady.",
    support:
      "Steady is software delivering structured self-guided experiences between visits. No published study evaluates Steady. Method evidence must never be presented as product evidence.",
    runnable: null,
  },
];

export const EVIDENCE_SOFTWARE: EvidenceItem[] = [
  {
    claim: "Access decisions are deterministic and reproducible.",
    support: "The safety suite covers the ordered gate chain and its rules.",
    runnable: "npm run test:safety",
  },
  {
    claim: "History can be rebuilt from the event log without drift.",
    support:
      "A reset produces a reproducible baseline, the backfill is idempotent, and projections rebuild byte-identically.",
    runnable: "npm run demo -- verify",
  },
  {
    claim: "Cross-tenant access is denied at the database layer.",
    support: "Twelve attack cases run against a real Postgres cluster, and the job blocks the build.",
    runnable: "npm run test:rls",
  },
  {
    claim: "Cross-tenant access is denied at the application layer.",
    support: "Eighteen isolation cases and twelve transaction cases.",
    runnable: "npx tsx --test tests/tenant-isolation.test.ts",
  },
  {
    claim: "Clinical summaries cannot display an uncitable claim.",
    support:
      "A validator independent of the generator drops claims with no citation and claims citing events outside the evidence set.",
    runnable: "npx tsx --test tests/clinical-surface.test.ts",
  },
  {
    claim: "Public pages cannot silently regain retail or compliance claims.",
    support: "A source-level guard implements the claims policy as a build gate.",
    runnable: "npx tsx --test tests/public-copy-guard.test.ts",
  },
  {
    claim: "The interface meets automated accessibility checks.",
    support: "An axe-core audit blocks on any serious or critical violation across the public surfaces.",
    runnable: "npm run test:e2e",
  },
];

export const EVIDENCE_NEEDED: EvidenceItem[] = [
  {
    claim: "Human-factors testing of the session interface under stress",
    support: "An explicit condition of the existing clinical sign-off. Not yet performed.",
    runnable: null,
  },
  {
    claim: "Independent security review and penetration test",
    support:
      "Not yet commissioned. Deliberately sequenced after the Postgres cutover, so the test examines the architecture that will run rather than the one about to be replaced.",
    runnable: null,
  },
  {
    claim: "Clinical review of the clinician workflow",
    support: "The proposed review packet exists and has not been submitted.",
    runnable: null,
  },
  {
    claim: "Pilot protocol and outcome evaluation",
    support: "No participant has used Steady. No outcome data exists.",
    runnable: null,
  },
  {
    claim: "Payer evaluation design",
    support: "Candidate measures are defined. None has been evaluated.",
    runnable: null,
  },
];

export const EVIDENCE_BLS: EvidenceItem[] = [
  {
    claim: "Bilateral stimulation Part 6 is an active validation workstream, not a shipped feature.",
    support:
      "The environment can demonstrate intended protocol states, stop conditions, and escalation paths as a labelled simulation using fabricated scenarios.",
    runnable: null,
  },
  {
    claim: "Autonomous stimulation is off, and no configuration can turn it on.",
    support:
      "An explicit condition of the existing clinical sign-off, enforced in code: the policy loader refuses a configuration that would let the engine govern.",
    runnable: "npx tsx --test tests/clinical-policy.test.ts",
  },
];
