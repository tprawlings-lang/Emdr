// Where each information layer goes, per role.
//
// §25 defines four layers — action, meaning, evidence, raw record — and every
// one of the twenty page examples draws them as the same five-item rail:
// Overview, Progress, Actions, Evidence, Audit. Identical for a member, a
// clinician, an organization, a payer and a reviewer.
//
// That sameness is the design. The rail is not a feature menu, so it does not
// grow when a role has more features; what changes between roles is what each
// layer CONTAINS. A member's "Actions" is their activities. A clinician's is
// their queue. A payer's is their cohort methods.
//
// A layer with no destination for a role renders as plain text rather than a
// link that goes nowhere (AppShell), which is why these are Partial records
// and why omissions below are deliberate rather than unfinished.

import type { RailSlug } from "@/components/app/AppShell";

export type Rail = Partial<Record<RailSlug, string>>;

/** Audit is deliberately absent. §30.6's minimum-necessary rule gives a member
 *  their record through consent and care team, not a governed event log. */
export const MEMBER_RAIL: Rail = {
  overview: "/app/today",
  progress: "/app/progress",
  actions: "/app/activities",
  evidence: "/app/plan",
};

/** The caseload-level clinician rail. Audit is per-person rather than global —
 *  there is no console-wide event log a clinician is entitled to read, and
 *  §30.6 stops one from being invented here. */
export const CLINICIAN_RAIL: Rail = {
  overview: "/clinician/today",
  progress: "/clinician/caseload",
  actions: "/clinician/handoffs",
  evidence: "/clinician/reports",
};

/** Inside one person's record, every layer has a destination — which is what
 *  the clinician mockups draw (p59–p63): the same five items, all live. */
export function personRail(id: string): Rail {
  const base = `/clinician/member/${id}`;
  return {
    overview: base,
    progress: `${base}/measures`,
    actions: `${base}/safety`,
    evidence: `${base}/record`,
    audit: `${base}/audit`,
  };
}

/** Review and administration (p70, p71). Audit and evidence are the point of
 *  this role, so both are live; "Progress" has no meaning for a console that
 *  reviews decisions rather than people, and is left without a destination. */
export const REVIEW_RAIL: Rail = {
  overview: "/review",
  actions: "/review/testing",
  evidence: "/review/bls",
  audit: "/review/audit",
};

/** Steady Intelligence — the organization surfaces (p64–p66).
 *
 *  Audit has no destination. An organization reads aggregates, and a governed
 *  event log is person-level by construction — §30.6's rule that aggregate
 *  access does not create person-level access makes this omission the point
 *  rather than a gap. What this role can audit is its own exports, which lives
 *  under Evidence with the reports. */
export const ORGANIZATION_RAIL: Rail = {
  overview: "/organization/overview",
  progress: "/organization/outcomes",
  actions: "/organization/access",
  evidence: "/organization/reports",
};

/** Steady Intelligence — the payer surfaces (p67–p69).
 *
 *  Audit HAS a destination here, unlike the provider network's rail: a payer's
 *  audit subject is its own claims feed — lag, rejections, corrections,
 *  exclusions — which is aggregate by nature and reveals no person. */
export const PAYER_RAIL: Rail = {
  overview: "/payer/overview",
  progress: "/payer/outcomes",
  actions: "/payer/access",
  evidence: "/payer/evidence",
  audit: "/payer/data-quality",
};
