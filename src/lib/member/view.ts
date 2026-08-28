// The member surface boundary (Presentation Layer Handoff §3, §4).
//
// Volume 2 is unambiguous: scores, diagnostic bands, criteria labels, and
// hidden track names are not displayed to members, and any surface that
// contradicts that is a defect. The handoff's insight is that a prohibition is
// the weak form of this rule and a boundary is the strong one:
//
//   "Build the member renderer so it is structurally incapable of receiving a
//    score… If a score never crosses the boundary, leakage becomes impossible
//    rather than merely prohibited."
//
// So this module is the only thing a member surface asks for its day. The
// engine can evaluate thirty rules across six domains; what comes back through
// here is one of five day shapes, a list of practice references, and a copy
// key. There is no field a score could occupy, and `assertNoScores` fails loudly
// if one is ever attached dynamically.
//
// A note on why the shapes are so few. The member is not being protected from
// complexity for its own sake — Vol 1 B-6 requires one primary task per screen
// and minimal reading during activation, because trauma symptoms impair
// concentration and working memory. A screen that is legible at a desk can be
// unusable at 2am. Five shapes is what survives that.

import { MODULES, type TherapyModule } from "../modules";
import { checkModuleAccess } from "../gating";
import { GROUNDING_MODULE_IDS } from "../safety/module-verdict";

/** The five member-visible day shapes. The routing hierarchy collapses into
 *  these; nothing finer-grained reaches the surface. */
export type DayShape = "open" | "narrow" | "stabilizing" | "paused" | "crisis";

/** A practice the member can actually start today. A reference and a name —
 *  never a severity, never a reason it was chosen, never a reason another one
 *  was not. */
export interface PracticeRef {
  id: string;
  name: string;
  /** Roughly how long, so someone can judge whether they have the capacity.
   *  A duration is not a score. */
  minutes: number;
}

/** What a member surface receives. Every field is enumerated and the list is
 *  asserted in tests, so adding one is a deliberate act visible in a diff. */
export interface MemberDay {
  shape: DayShape;
  /** Everything available today. Nothing unavailable is described — absent is
   *  absent (§4). */
  practices: PracticeRef[];
  /** The single recommended next action, if there is one. */
  primary: PracticeRef | null;
  /** A governed, versioned copy key. Not a sentence: §8 requires every
   *  member-facing string be a copy key so the clinical copy review is a diff
   *  rather than an archaeology project. */
  messageKey: string;
  /** Crisis support is reachable from every screen, always. */
  humanSupport: true;
}

export const MEMBER_DAY_KEYS = [
  "shape", "practices", "primary", "messageKey", "humanSupport",
] as const;

/** Substrings that mark a field as score-bearing. Used by the boundary
 *  assertion and by the test that guards the model's shape. */
export const FORBIDDEN_DAY_KEYS = [
  "score", "band", "track", "severity", "readiness", "percent", "total",
  "rule", "criteria", "tier", "level",
] as const;

export class MemberBoundaryError extends Error {}

/** Reject anything score-bearing before it reaches a member surface.
 *
 *  Deliberately a runtime check as well as a type: the type protects the code
 *  we write, and this protects the object that gets built by a future helper
 *  that spreads something wider into it. The boundary has to hold against the
 *  edit nobody reviewed. */
export function assertNoScores(day: MemberDay): MemberDay {
  for (const key of Object.keys(day)) {
    const k = key.toLowerCase();
    const hit = FORBIDDEN_DAY_KEYS.find((f) => k.includes(f));
    if (hit) {
      throw new MemberBoundaryError(
        `"${key}" cannot cross the member boundary: it carries a ${hit}. ` +
        "Vol 2 forbids scores, bands, criteria labels, and track names on member surfaces."
      );
    }
    // A nested object is the other way a score arrives — a practice carrying
    // the severity that excluded its neighbour, for instance.
    const v = (day as unknown as Record<string, unknown>)[key];
    if (v && typeof v === "object") {
      for (const inner of flattenKeys(v)) {
        const ik = inner.toLowerCase();
        const innerHit = FORBIDDEN_DAY_KEYS.find((f) => ik.includes(f));
        if (innerHit) {
          throw new MemberBoundaryError(
            `"${key}.${inner}" cannot cross the member boundary: it carries a ${innerHit}.`
          );
        }
      }
    }
  }
  return day;
}

function flattenKeys(v: unknown, depth = 0): string[] {
  if (depth > 3 || !v || typeof v !== "object") return [];
  if (Array.isArray(v)) return v.flatMap((x) => flattenKeys(x, depth + 1));
  return Object.entries(v as Record<string, unknown>).flatMap(([k, val]) =>
    [k, ...flattenKeys(val, depth + 1)]
  );
}

// ---------------------------------------------------------------------------
// Building the day
// ---------------------------------------------------------------------------

const MINUTES: Record<string, number> = {
  "calm-place": 10, containment: 8, "body-scan": 12, "trigger-map": 15,
  resourcing: 10, "recent-trigger": 25, "safe-target": 30, installation: 20,
  "future-template": 20, relational: 25, maintenance: 15,
};

function ref(m: TherapyModule): PracticeRef {
  return { id: m.id, name: m.name, minutes: MINUTES[m.id] ?? 15 };
}

/** Copy keys, versioned. §8: every member-facing string is a key, never an
 *  inline literal, so the clinical copy review is a diff. */
export const DAY_COPY: Record<DayShape, string> = {
  open: "day.open.v1",
  narrow: "day.narrow.v1",
  stabilizing: "day.stabilizing.v1",
  paused: "day.paused.v1",
  crisis: "day.crisis.v1",
};

/** The rendered copy for each shape.
 *
 *  Every one of these frames a narrowed day as the day's work rather than as a
 *  restriction. §2: "If narrowing reads as 'you failed the check,' you produce
 *  shame in a population where shame drives disengagement." None of them
 *  explains WHY beyond a plain, non-clinical sentence — the explanation is
 *  where the criteria label leaks back in. */
export const DAY_MESSAGE: Record<string, string> = {
  "day.open.v1": "Everything is open today. Start wherever you like.",
  "day.narrow.v1": "Today is a grounding day. These are the practices for it.",
  "day.stabilizing.v1": "Today is for steadying. These practices are here whenever you want them.",
  "day.paused.v1": "Processing work is on hold for now. Grounding and support stay open, and someone can help you pick this back up.",
  "day.crisis.v1": "Support is what matters right now.",
};

/** The member's day.
 *
 *  The ONLY entry point a member surface may use for day state. It reads the
 *  gate for every module and reports what is available — it never reports what
 *  is not, or why, because "why" is the criteria label. */
export async function buildMemberDay(userId: string): Promise<MemberDay> {
  const available: PracticeRef[] = [];
  let anyCrisis = false;
  let anyPaused = false;
  let groundingOnly = true;

  for (const m of MODULES) {
    const access = await checkModuleAccess(userId, m);
    if (access.allowed) {
      available.push(ref(m));
      if (!GROUNDING_MODULE_IDS.has(m.id)) groundingOnly = false;
      continue;
    }
    // The reasons are read to pick the day's SHAPE and then discarded. They
    // are not returned, so no surface can render one.
    if (access.action === "crisis") anyCrisis = true;
    if (access.action === "paused" || access.action === "cooldown") anyPaused = true;
  }

  const shape: DayShape =
    anyCrisis ? "crisis"
    : available.length === 0 ? "paused"
    : anyPaused ? "stabilizing"
    : groundingOnly ? "narrow"
    : "open";

  // The single recommended next action. First available in catalogue order,
  // which is already clinically sequenced — not a ranking the member could
  // read as a score.
  const primary = available[0] ?? null;

  return assertNoScores({
    shape,
    practices: available,
    primary,
    messageKey: DAY_COPY[shape],
    humanSupport: true,
  });
}

/** The horizon position for a day shape (§7's signature element).
 *
 *  One thin rule that sits lower on a narrow day and higher on an open one. It
 *  carries the day's shape without a number, a colour code, or a label.
 *
 *  DELIBERATELY STATELESS, and this is the boundary condition the handoff
 *  flags: a single static position per day is a state indicator. The moment it
 *  animates across days, shows history, or can be scrubbed back through, it
 *  becomes a trend chart and violates Vol 2. There is no API here that takes a
 *  date range, and that absence is the design. */
export function horizonPosition(shape: DayShape): number {
  const AT: Record<DayShape, number> = {
    open: 0.28, narrow: 0.52, stabilizing: 0.62, paused: 0.74, crisis: 0.5,
  };
  return AT[shape];
}
