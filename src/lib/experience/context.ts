// The experience context (handoff 09 §9, Package 1).
//
// §9's shape: "Authoritative identity, tenant, and capabilities server-side; a
// minimal client view." Its reason: "A browser-supplied role or tenant is not
// command authority."
//
// THAT SENTENCE IS THE WHOLE MODULE. Everything a role-based portal needs to
// know — who is here, which tenant they are acting in, what they may reach — is
// exactly the set of facts an attacker most wants to supply. So there are two
// types below rather than one, and the split is not cosmetic:
//
//   `ExperienceContext` is resolved on the server from the authenticated
//   request. It carries the tenant and the capability set. It has no
//   constructor that takes a role.
//
//   `ClientExperience` is what a client component may hold. It carries the
//   viewer's display name, their audience, and the capability KEYS they have —
//   enough to render a sidebar, and not enough to authorize anything. There is
//   no path from a `ClientExperience` back to an `ExperienceContext`.
//
// AND THE CAPABILITY SET IS NOT A PERMISSION SET. A capability here answers
// "does this part of the product work, for this person, in this deployment" —
// which is §9's reason for putting capability state in the navigation manifest
// at all: "a route file alone does not establish usable functionality." Whether
// somebody is ALLOWED to do a thing stays where it already is, in the safety
// engine, the repository's tenant scoping, and the `require*` guards in
// src/lib/auth.ts. This layer decides what to draw, never what to permit.

import type { SessionUser } from "../auth";
import type { Audience } from "../app/route-register";

/**
 * What a person can actually reach in this deployment.
 *
 * Named after the JOB rather than the feature, because a capability is a
 * promise to a person and features get renamed. `messageAClinician` is false
 * in this build and the honest reason is in the route register; a capability
 * called `messaging` would invite somebody to turn it on because the module
 * exists.
 */
export const CAPABILITIES = [
  "recordADayShape",
  "doAnActivity",
  "readOwnProgress",
  "messageAClinician",
  "seeOwnCareTeam",
  "reviewAttentionQueue",
  "openAPersonRecord",
  "handOverAPerson",
  "referAPersonOut",
  "messageAMember",
  "scheduleAnAppointment",
  "readAggregateOutcomes",
  "requestAnExport",
  "recordAReleaseDecision",
  "operateTheDemoEnvironment",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Why a capability is off, when it is. Shown rather than inferred: §8.4
 *  requires `unavailable` to name a "feature or environment reason" and never
 *  to imply a zero value. */
export interface CapabilityState {
  available: boolean;
  /** Required when `available` is false. */
  reason?: string;
}

/**
 * The server-side context.
 *
 * NO CONSTRUCTOR TAKES A ROLE. `experienceContextFor` takes a `SessionUser`,
 * which is only produced by `src/lib/auth.ts` from a verified token — so the
 * only way to obtain a context is to have been authenticated, and the only way
 * to change your audience is to be a different person.
 */
export interface ExperienceContext {
  personId: string;
  /** The acting tenant, from the session. Never from a parameter, a header, a
   *  query string or a form field. */
  tenantId: string;
  audience: Audience;
  displayName: string;
  capabilities: Record<Capability, CapabilityState>;
}

/**
 * The minimal client view.
 *
 * WHAT IS ABSENT IS THE DESIGN. No tenant id, because a client that holds one
 * will eventually send it. No role string, because a role in the browser is a
 * role an attacker can edit — the audience is here for LAYOUT, and the guard in
 * tests/experience-contracts.test.ts asserts that nothing in the experience
 * layer authorizes against it.
 */
export interface ClientExperience {
  displayName: string;
  /** For layout only. Every authorization decision is made server-side, from
   *  `ExperienceContext`, before anything reaches a client component. */
  audience: Audience;
  /** Which capabilities are on, as keys. A client renders a destination when
   *  its capability is in this set and omits it otherwise (§1.1). */
  available: Capability[];
}

/** The audience for a session role. One place, so a new role cannot acquire an
 *  audience by accident. */
const AUDIENCE_FOR: Record<string, Audience> = {
  member: "member",
  clinician: "clinician",
  care_manager: "clinician",
  organization: "organization",
  payer: "payer",
  reviewer: "reviewer",
  demo_admin: "demo_admin",
};

/**
 * The capabilities this build actually has.
 *
 * SOURCED FROM THE ROUTE REGISTER'S TRUTH, not from a wish list. Each `false`
 * below corresponds to a route the register records as capability-absent, and
 * the guard in tests/experience-contracts.test.ts asserts they agree — so
 * turning a capability on without building it fails the build, and building one
 * without turning it on is caught too.
 */
const BUILD_CAPABILITIES: Record<Capability, CapabilityState> = {
  recordADayShape: { available: true },
  doAnActivity: { available: true },
  readOwnProgress: { available: true },
  messageAClinician: {
    available: false,
    reason: "There is no message store, thread, recipient or delivery path in this build.",
  },
  seeOwnCareTeam: { available: true },
  reviewAttentionQueue: { available: true },
  openAPersonRecord: { available: true },
  handOverAPerson: {
    available: false,
    reason: "There is no handoff record, recipient or acceptance step in this build.",
  },
  referAPersonOut: {
    available: false,
    reason: "There is no referral record or destination in this build.",
  },
  messageAMember: {
    available: false,
    reason: "There is no message store, thread or delivery path in this build.",
  },
  scheduleAnAppointment: {
    available: false,
    reason: "There is no scheduling model in this build.",
  },
  readAggregateOutcomes: { available: true },
  requestAnExport: { available: true },
  recordAReleaseDecision: { available: true },
  operateTheDemoEnvironment: { available: true },
};

/** Which audiences a capability is offered to at all. A member has no business
 *  seeing `reviewAttentionQueue` even when it works. */
const OFFERED_TO: Record<Capability, Audience[]> = {
  recordADayShape: ["member"],
  doAnActivity: ["member"],
  readOwnProgress: ["member"],
  messageAClinician: ["member"],
  seeOwnCareTeam: ["member"],
  reviewAttentionQueue: ["clinician"],
  openAPersonRecord: ["clinician"],
  handOverAPerson: ["clinician"],
  referAPersonOut: ["clinician"],
  messageAMember: ["clinician"],
  scheduleAnAppointment: ["clinician"],
  // The clinician is here because /clinician/reports works: a clinician
  // reading an aggregate report about their OWN panel is not the aggregate
  // console, and leaving them off made the manifest drop a destination the
  // register says exists. Caught by the padding guard, which is what that
  // guard is for.
  readAggregateOutcomes: ["clinician", "organization", "payer"],
  requestAnExport: ["organization", "payer"],
  recordAReleaseDecision: ["reviewer"],
  operateTheDemoEnvironment: ["demo_admin"],
};

/** The capability state for one audience: off where the build lacks it, and off
 *  where the audience is not offered it — with different reasons, because
 *  "not built" and "not yours" are different sentences (§8.4). */
export function capabilitiesFor(audience: Audience): Record<Capability, CapabilityState> {
  const out = {} as Record<Capability, CapabilityState>;
  for (const c of CAPABILITIES) {
    if (!OFFERED_TO[c].includes(audience)) {
      out[c] = { available: false, reason: "Not part of this workspace." };
      continue;
    }
    out[c] = BUILD_CAPABILITIES[c];
  }
  return out;
}

/**
 * Resolve the context from an authenticated user.
 *
 * The only entry point, and it takes a `SessionUser` — which only
 * `src/lib/auth.ts` produces, and only from a verified token. There is
 * deliberately no `experienceContextFromRequest`, no override parameter, and no
 * way to pass a tenant.
 */
export function experienceContextFor(user: SessionUser): ExperienceContext {
  const audience = AUDIENCE_FOR[user.role] ?? "public";
  return {
    personId: user.id,
    tenantId: user.tenantId,
    audience,
    displayName: user.name,
    capabilities: capabilitiesFor(audience),
  };
}

/** Narrow a server context to what a client component may hold. */
export function toClient(ctx: ExperienceContext): ClientExperience {
  return {
    displayName: ctx.displayName,
    audience: ctx.audience,
    available: CAPABILITIES.filter((c) => ctx.capabilities[c].available),
  };
}

export function can(ctx: ExperienceContext, capability: Capability): boolean {
  return ctx.capabilities[capability].available;
}

/** Why a capability is off, for a surface that has to say so. */
export function whyNot(ctx: ExperienceContext, capability: Capability): string | null {
  const state = ctx.capabilities[capability];
  return state.available ? null : state.reason ?? "Not available here.";
}
