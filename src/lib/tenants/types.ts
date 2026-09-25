// Per-tenant configuration (Handoff 11 §2). A partner's settings live in one
// file under src/lib/tenants, loaded by tenant id; nothing partner-specific is
// written anywhere else.

export type TenantMode =
  /** An ordinary tenant. */
  | "standard"
  /** Handoff 11: a partner evaluating Steady on synthetic data. A banner on
   *  every screen, PHI fields locked at the database, alerts to a test inbox,
   *  and draft content visible (marked) as in the demo. */
  | "evaluation";

export interface MeasureCadence {
  /** Days between deliveries between visits. */
  cadenceDays: number;
  /** Also delivered before each visit. */
  beforeVisit: boolean;
}

export interface TenantConfig {
  /** The tenant's id in the `tenants` table. */
  id: string;
  mode: TenantMode;
  displayName: string;
  /** The partner's logo is theirs to supply; until it is in the repository the
   *  name is shown in text. */
  coBrand: { partnerLogo: string | null; poweredBy: "Steady" };
  /** US states the partner operates in (member terms, crisis resources). */
  states: readonly string[];
  /** Site names: generic, never a real partner clinic's. */
  sites: readonly string[];
  measures: { phq9: MeasureCadence; gad7: MeasureCadence };
  /** Treat-to-target defaults, editable by the partner's clinical lead. */
  treatToTarget: {
    responseReductionPct: number;
    remissionPhq9Below: number;
    reviewIfNotRespondingByWeek: number;
  };
  escalation: {
    memberCrisisCopy: string;
    /** The partner supplies these; null shows nothing rather than a guess. */
    careTeamContact: { phone: string | null; hours: string | null };
    /** Shown to staff, never enforced and never promised to members. */
    alertSlaHours: number;
  };
  assignableCatalog: "signed-plus-partner-slots";
}
