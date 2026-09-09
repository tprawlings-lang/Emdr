// Reading the member's day from the server (handoff 09 §4.1, §4.2, §4.4;
// Package 3).
//
// THIS IS THE ONLY PLACE THE TWO NON-GATE STATES ARE DECIDED, and the reason it
// is a separate module from member-day.ts is that member-day.ts is pure and
// client-safe. The shape of the day is a decision anybody can test with a
// literal; whether TODAY is interrupted is a question only a database answers.
//
// AND IT LIVES HERE RATHER THAN IN src/lib/experience/ BECAUSE PACKAGE 1'S OWN
// GUARD SAID SO. It was written as experience/member-day-store.ts and the "no
// raw SQL anywhere in the experience layer" contract test rejected it on the
// first full run — the same way it rejected Package 2's clinician commands.
// That is the guard doing its job on the person who wrote it: the experience
// layer reshapes what the domain hands it and owns no queries, so a module with
// a SELECT in it belongs in the domain. This is the third module to move for
// that reason and the rule has not needed a comment yet.
//
// §4.4 IS WHY THIS MODULE EXISTS AT ALL rather than the page reading a flag:
//
//   "On reconnect, check current server state before offering resume. A prior
//    answer or permission may no longer be valid."
//
// Two things can have changed while somebody was away from an unfinished
// session, and they are the two that matter most. Their answers may not have
// landed — so the committed step comes from the row, never from the browser.
// And the GATE MAY HAVE CLOSED — so `stillPermitted` is a fresh
// `checkModuleAccess`, asked now, not the verdict that was true when they
// started. Offering "pick up where you left off" without that second check
// offers to resume a processing session the member is no longer cleared for,
// which is a safety failure dressed as a convenience.
//
// AND A FAILED READ IS A STATE, NOT AN EMPTY PAGE. §1.11 restored
// `service_unavailable` precisely so that a projection Steady could not read
// renders as "Steady cannot load your day" rather than as an open day with
// nothing in it — which is a different and false sentence to show somebody at
// two in the morning.

import { data } from "../data";
import { buildMemberDay } from "./view";
import { memberHistory } from "./history";
import { checkModuleAccess } from "../gating";
import { getModule } from "../modules";
import { memberDayView, type MemberDayView } from "../experience/member-day";
import { resumeDecision, type ResumeOffer } from "../experience/activity-shell";

export interface MemberDayRead {
  view: MemberDayView;
  /** What may be offered about an unfinished activity. Always computed against
   *  server state — `ask_server` cannot come back from here, because here IS
   *  the server. */
  resume: ResumeOffer;
}

/**
 * Everything the Today surface needs, in one read.
 *
 * THE CATCH IS NOT DEFENSIVE PROGRAMMING. `buildMemberDay` walks every module
 * through the gate; if any part of that fails, the honest answer is that Steady
 * does not know what today is — and the member still gets grounding and crisis
 * on the screen, because `memberDayView` puts them in every state's required
 * paths. Swallowing the failure into an empty day is the bug this prevents.
 */
export async function readMemberDay(args: {
  userId: string;
  now?: string;
}): Promise<MemberDayRead> {
  const now = args.now ?? new Date().toISOString();

  let day = null;
  try {
    day = await buildMemberDay(args.userId);
  } catch {
    // Deliberately not rethrown and deliberately not logged as fatal: the
    // surface has a designed state for this, and it is a better answer than a
    // 500 to somebody who came here for a grounding exercise.
    day = null;
  }

  const unfinished = await unfinishedSession(args.userId);
  const resume = await resumeFor(args.userId, unfinished);

  return {
    view: memberDayView({
      day,
      // Only an activity a person can actually return to makes the day
      // `interrupted`. A session the gate has since closed is not an
      // interruption to resume — it is a day that is set up differently now,
      // and `resumeDecision` says so in its own words.
      interrupted:
        resume.decision === "resume" && unfinished
          ? {
              activityId: unfinished.moduleId,
              title: unfinished.title,
              resumeHref: `/app/session/${unfinished.moduleId}`,
            }
          : null,
      recent: await recentQuietly(args.userId),
      now,
    }),
    resume,
  };
}

interface Unfinished {
  sessionId: string;
  moduleId: string;
  title: string;
  committedStep: number;
  startedAt: string;
}

/** The most recent session left in progress. One, not a list: §4.1 gives
 *  Today one primary action, and a screen offering three things to resume is
 *  the choice load §3.4 named. */
async function unfinishedSession(userId: string): Promise<Unfinished | null> {
  const c = await data();
  const row = (await c.get(
    `SELECT id, module_id, detail_json, started_at
       FROM therapy_sessions
      WHERE user_id = ? AND status = 'in_progress'
      ORDER BY started_at DESC
      LIMIT 1`,
    [userId]
  )) as { id: string; module_id: string; detail_json: string; started_at: string } | undefined;
  if (!row) return null;

  const mod = getModule(row.module_id);
  if (!mod) return null;

  return {
    sessionId: row.id,
    moduleId: row.module_id,
    title: mod.name,
    committedStep: committedStep(row.detail_json),
    startedAt: row.started_at,
  };
}

/** How far the SERVER says they got. A row with no recorded step is a session
 *  that was opened and not worked, which is `0` — and `resumeDecision` turns
 *  that into "there is nothing to come back to" rather than "resume step 0". */
function committedStep(detailJson: string): number {
  try {
    const detail = JSON.parse(detailJson) as Record<string, unknown>;
    const step = detail.committedStep ?? detail.setsCompleted ?? detail.step;
    return typeof step === "number" && Number.isFinite(step) && step > 0 ? Math.floor(step) : 0;
  } catch {
    return 0;
  }
}

/** §4.4's check, in full. The permission is re-asked; it is not remembered. */
async function resumeFor(userId: string, unfinished: Unfinished | null): Promise<ResumeOffer> {
  if (!unfinished) {
    return resumeDecision({ local: null, server: { activityId: "", committedStep: 0, stillPermitted: true } });
  }
  const mod = getModule(unfinished.moduleId);
  let stillPermitted = false;
  try {
    stillPermitted = mod ? (await checkModuleAccess(userId, mod)).allowed : false;
  } catch {
    // A gate that cannot be read is not a gate that said yes.
    stillPermitted = false;
  }
  return resumeDecision({
    local: null,
    server: {
      activityId: unfinished.moduleId,
      committedStep: unfinished.committedStep,
      stillPermitted,
    },
  });
}

/** §4.1: "Recent activity shown quietly." Three items, newest first, each one
 *  a thing that happened and the day it happened on. No count, no run, no
 *  comparison — `memberHistory` already refuses those (HISTORY_FORBIDDEN) and
 *  this does not reintroduce them by aggregating. */
async function recentQuietly(userId: string): Promise<Array<{ kind: string; occurredAt: string }>> {
  try {
    const days = await memberHistory(userId, { days: 14 });
    const flat: Array<{ kind: string; occurredAt: string }> = [];
    for (const d of days) {
      for (const item of d.items) {
        flat.push({ kind: item.name, occurredAt: d.day });
      }
    }
    return flat.slice(0, 3);
  } catch {
    // Recent activity is the least important thing on the screen. It is not
    // worth failing the day for.
    return [];
  }
}
