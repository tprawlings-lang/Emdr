// The member_today projection (Web GUI handoff §30.3, §10.1, page example
// "Member Today", schema member_today.v4).
//
// The member side has never had a projection. /app/today (formerly /dashboard)
// assembles itself from whatever it can reach — check-in row, gating calls,
// practice lists — and decides in the page what the member should do. §8 forbids
// exactly that: "The UI should never build clinical meaning by joining raw event
// arrays in React." §30.1 states the target: "The browser receives only the
// projection and actions authorized for that actor."
//
// The page example is explicit about hierarchy: one primary action with an
// expected duration, one sentence of why, up to two safe alternatives, and
// support. §20.2: "Today shows no more than one primary and two secondary
// actions." That cap is not a style preference — §3.4 found the old Home was a
// content catalog that "makes the member decide what matters now. On a hard
// day, that choice load is exactly what the system should reduce."
//
// This composes the existing member boundary rather than going around it:
// buildMemberDay is still the only thing that reads the member's day, and
// assertNoScores still runs on it. §26's member acceptance — "no score is
// presented as diagnosis, readiness or proof of improvement" — is upheld here
// by construction, not by review.

import { buildMemberDay, assertNoScores, type MemberDay, type PracticeRef, type DayShape } from "./view";
import { getTodayCheckin } from "../gating";
import { activePolicy } from "../clinical-policy";
import {
  ready, empty, policyUnavailable, type Envelope, type ProjectionMeta,
} from "../presentation/envelope";

export const MEMBER_TODAY_SCHEMA = "member_today.v4";

/** One thing the member can do, with what it costs them.
 *
 *  `minutes` is here because the page example leads with "Up next — about 2
 *  minutes". A member deciding whether they have capacity needs the cost before
 *  the label; a duration is not a score. */
export interface TodayAction {
  id: string;
  label: string;
  href: string;
  minutes: number | null;
  /** One sentence. §10.1: "One sentence explaining why." */
  why: string;
}

export interface MemberToday {
  shape: DayShape;
  /** §10.1's headline state, as a governed copy key rather than a sentence —
   *  the clinical copy review has to be a diff, not an archaeology project. */
  messageKey: string;
  /** Exactly one, or none when the day has nothing to offer. */
  primary: TodayAction | null;
  /** At most two (§20.2). Enforced, not trusted. */
  alternatives: TodayAction[];
  /** Always present, always reachable, in every envelope state. */
  support: { label: string; href: string };
  /** Whether today's check-in is still outstanding. §10.1: "If the check-in is
   *  due, it becomes the primary action." */
  checkinDue: boolean;
}

export class MemberTodayError extends Error {}

const SUPPORT = { label: "Get support", href: "/crisis" } as const;

function actionFor(p: PracticeRef, why: string): TodayAction {
  return { id: p.id, label: p.name, href: `/app/session/${p.id}`, minutes: p.minutes, why };
}

/** Why this plan, per day shape. Copy keys, resolved at the surface. */
const WHY: Record<DayShape, string> = {
  open: "Your check-in suggests a full session is available today.",
  narrow: "Your check-in suggests keeping today lighter.",
  stabilizing: "Your check-in suggests regulation before processing.",
  paused: "Processing is paused today. Grounding and regulation remain open.",
  crisis: "The safest step right now is support, not a session.",
};

/** Build the member's day as a projection.
 *
 *  Returns an envelope rather than a value, because §30.8's states are the
 *  point: a member whose policy cannot be evaluated must not get an empty-
 *  looking Today that implies nothing is available. That state fails closed and
 *  says so, and keeps grounding and crisis reachable. */
export async function buildMemberToday(args: {
  userId: string;
  tenantId: string;
  now?: Date;
}): Promise<Envelope<MemberToday>> {
  const policy = activePolicy();
  const now = args.now ?? new Date();
  const meta: ProjectionMeta = {
    schemaVersion: MEMBER_TODAY_SCHEMA,
    projectionVersion: `${MEMBER_TODAY_SCHEMA}+${policy.version}`,
    generatedAt: now.toISOString().replace("T", " ").slice(0, 19),
    tenantId: args.tenantId,
    sourceWatermark: null,
    policyVersion: policy.version,
  };

  let day: MemberDay;
  try {
    day = assertNoScores(await buildMemberDay(args.userId));
  } catch (e) {
    // A failure to evaluate the day is a SAFETY decision failure, not an empty
    // day. §30.8: "Policy unavailable — block new session start; keep grounding
    // and crisis paths." Returning `empty` here would tell a member there is
    // nothing for them today, which is a different and false statement.
    if (e instanceof Error && /boundary/i.test(e.message)) throw e;
    return policyUnavailable<MemberToday>(meta);
  }

  const checkin = await getTodayCheckin(args.userId);
  const checkinDue = !checkin;

  // §10.1: "If the check-in is due, it becomes the primary action." It outranks
  // everything, because every downstream decision is computed from it.
  const primary: TodayAction | null = checkinDue
    ? {
        id: "check-in",
        label: "Start check-in",
        href: "/app/check-in",
        minutes: 2,
        why: "Your answer selects the safest available next step.",
      }
    : day.primary
      ? actionFor(day.primary, WHY[day.shape])
      : null;

  // At most two alternatives, and never the one already offered as primary.
  const alternatives = day.practices
    .filter((p) => p.id !== day.primary?.id)
    .slice(0, 2)
    .map((p) => actionFor(p, WHY[day.shape]));

  const today: MemberToday = {
    shape: day.shape,
    messageKey: day.messageKey,
    primary,
    alternatives,
    support: SUPPORT,
    checkinDue,
  };
  assertTodayShape(today);

  // An empty day is a real state with its own words — not a blank screen.
  if (!primary && alternatives.length === 0) {
    return empty<MemberToday>(
      meta,
      "Nothing is scheduled for you right now. Grounding, the companion and support stay open."
    );
  }
  return ready(meta, today);
}

/** Enforce §20.2's cap and the support guarantee.
 *
 *  A runtime check because the cap is the whole design: a Today with four
 *  options has quietly become the catalog §3.4 describes, and it gets there one
 *  well-meaning addition at a time. */
export function assertTodayShape(t: MemberToday): MemberToday {
  if (t.alternatives.length > 2) {
    throw new MemberTodayError(
      `Today carries ${t.alternatives.length} secondary actions. §20.2 allows one primary and ` +
      "two secondary — beyond that it is a catalog, and choice load is the thing this screen removes."
    );
  }
  if (t.primary && t.alternatives.some((a) => a.id === t.primary!.id)) {
    throw new MemberTodayError("the primary action is repeated as an alternative");
  }
  if (!t.support?.href) {
    throw new MemberTodayError("Today has no support path; support is reachable in every state");
  }
  return t;
}
