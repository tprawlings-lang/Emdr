// The six demo roles (handoff 07 §1.2, p6; permission matrix §5.5, p50).
//
// One module, because the alternative is what this codebase had until now: a
// role literal repeated in an auth guard, a redirect, a seed file and a schema
// CHECK, drifting independently. `admin` had already drifted — it was the
// AGGREGATE reporting role here, and handoff 07 uses "Demo Admin" for
// something close to its opposite. Reusing that name would have been the most
// dangerous rename in the project.
//
// The rule this file exists to hold (p4, p6):
//
//   THE ROLE SELECTOR PROVIDES CONTEXT AND REDUCES DEMO FRICTION. AUTHORIZATION
//   STILL COMES FROM THE SERVER-SIDE IDENTITY, TENANT AND PERMISSION CLAIMS.
//   A USER CANNOT SELECT DEMO ADMIN AND AUTHENTICATE WITH THE CLINICIAN
//   ACCOUNT.
//
// So nothing here is read from the client. The dropdown on /login renders
// `DEMO_ROLES` for labels; the server re-derives everything from the stored
// account.

/**
 * The stored role. `member` keeps its name rather than becoming `patient`:
 * thirty-six member routes, the whole gate chain and every safety guard read
 * it, and a rename with no behaviour change is risk without benefit. The
 * handoff's word is a LABEL, carried in `DEMO_ROLES` below.
 */
export type Role =
  | "member"
  | "clinician"
  | "reviewer"
  | "organization"
  | "payer"
  | "demo_admin";

export const ROLES: readonly Role[] = [
  "member", "clinician", "reviewer", "organization", "payer", "demo_admin",
] as const;

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export interface DemoRole {
  /** The stored role this persona authenticates as. */
  role: Role;
  /** What the dropdown says. Handoff p6's word, which is not always ours. */
  label: string;
  /** Where this role lands. p6: "reach its correct landing page in two actions". */
  landing: string;
  /** p6's "what the role can see" — shown under the dropdown, so a presenter
   *  can say what the role is before signing in. */
  sees: string;
  /** p6's "what the role cannot see". Rendered with equal weight, because the
   *  boundary is the interesting half at a demo. */
  cannotSee: string;
}

/**
 * The catalogue, in p6's order.
 *
 * This is public configuration — GET /api/demo/personas (p47) returns it — so
 * it must contain nothing that is not already on a printed page of the
 * handoff. No account ids, no tenant ids, no passwords.
 */
export const DEMO_ROLES: readonly DemoRole[] = [
  {
    role: "member",
    label: "Patient",
    landing: "/app/today",
    sees: "Self, own actions, own measures, own evidence",
    cannotSee: "Other people, aggregate comparisons, model internals",
  },
  {
    role: "clinician",
    label: "Clinician",
    landing: "/clinician/today",
    sees: "Assigned panel, safety queue, cited summaries, actions",
    cannotSee: "Unassigned patients, payer cost model, system config",
  },
  {
    role: "reviewer",
    label: "Reviewer",
    landing: "/review/safety",
    sees: "Fixed gates, evidence, replay, corrections, audit",
    cannotSee: "Routine treatment decisions, credential management",
  },
  {
    role: "payer",
    label: "Payer",
    landing: "/payer/overview",
    sees: "Aggregate access, engagement, outcomes, utilization, cost",
    cannotSee: "Patient-level clinical records or person search",
  },
  {
    role: "organization",
    label: "Organization",
    landing: "/organization/overview",
    sees: "Aggregate access, capacity, outcomes, service gaps",
    cannotSee: "Payer-wide data or unrelated organizations",
  },
  {
    role: "demo_admin",
    label: "Demo Admin",
    landing: "/admin/demo",
    sees: "All fabricated tenants, roles, people, events, reset and QA",
    cannotSee: "Any production environment or real data",
  },
] as const;

export function landingFor(role: Role): string {
  return DEMO_ROLES.find((r) => r.role === role)?.landing ?? "/app/today";
}

export function labelFor(role: Role): string {
  return DEMO_ROLES.find((r) => r.role === role)?.label ?? role;
}

// ---------------------------------------------------------------------------
// Role families
// ---------------------------------------------------------------------------

/**
 * The AGGREGATE roles: they read a population and must never reach a person
 * (§30.6 of handoff 06, p50 of this one).
 *
 * `demo_admin` is here because p6 grants it "all fabricated tenants, roles,
 * people, events" — and that breadth is exactly why it is confined to the
 * fabricated environment. p6 again: production administration must use
 * purpose-limited permissions and break-glass access; do not carry the demo
 * admin's blanket visibility into production.
 */
export const AGGREGATE_ROLES: readonly Role[] = ["organization", "payer", "demo_admin"] as const;

export function isAggregateRole(role: Role): boolean {
  return AGGREGATE_ROLES.includes(role);
}

/**
 * The permission matrix (p50), as data.
 *
 * "no" is written rather than omitted, because an absent row and a denied one
 * read identically in a table and only one of them is a decision.
 */
export type Grant = "no" | "own" | "assigned" | "subset" | "aggregate" | "yes";

export const PERMISSIONS: Record<string, Record<Role, Grant>> = {
  own_person_view:  { member: "own", clinician: "assigned", reviewer: "subset",    organization: "no",        payer: "no",        demo_admin: "yes" },
  clinician_queue:  { member: "no",  clinician: "assigned", reviewer: "subset",    organization: "no",        payer: "no",        demo_admin: "yes" },
  safety_replay:    { member: "own", clinician: "assigned", reviewer: "yes",       organization: "no",        payer: "no",        demo_admin: "yes" },
  aggregate_metrics:{ member: "own", clinician: "assigned", reviewer: "subset",    organization: "aggregate", payer: "aggregate", demo_admin: "yes" },
  cost_model:       { member: "no",  clinician: "no",       reviewer: "no",        organization: "aggregate", payer: "aggregate", demo_admin: "yes" },
  fairness_audit:   { member: "no",  clinician: "subset",   reviewer: "yes",       organization: "aggregate", payer: "aggregate", demo_admin: "yes" },
  planning_review:  { member: "no",  clinician: "subset",   reviewer: "yes",       organization: "subset",    payer: "subset",    demo_admin: "yes" },
  seed_manifest:    { member: "no",  clinician: "no",       reviewer: "subset",    organization: "no",        payer: "no",        demo_admin: "yes" },
  reset_data:       { member: "no",  clinician: "no",       reviewer: "no",        organization: "no",        payer: "no",        demo_admin: "yes" },
  credential_config:{ member: "no",  clinician: "no",       reviewer: "no",        organization: "no",        payer: "no",        demo_admin: "subset" },
};

/** Whether a role has any grant at all on a capability. The SHAPE of the grant
 *  (own, assigned, aggregate) is enforced by the projection that serves it —
 *  this only answers whether the door opens. */
export function permits(capability: keyof typeof PERMISSIONS, role: Role): boolean {
  return PERMISSIONS[capability]?.[role] !== "no";
}
