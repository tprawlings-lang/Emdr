import type Database from "better-sqlite3";
import { evaluateCheckin } from "@/lib/gating";
import { evaluateAccess } from "@/lib/safety/engine";
import { AccessTier } from "@/lib/safety/types";
import { accessProfileFor } from "@/lib/demo-population-disparity";
import {
  AGENT_HORIZON, GENERATED_DAYS, agentWindowFor, demoEpoch, enrolmentDayFor, exposureDaysFor,
  scaledRange,
} from "@/lib/demo-population-calendar";
import { TARGETS } from "@/lib/demo-population-generator";
import { MANIFEST, seedFor, type ManifestRow } from "@/lib/demo-population-manifest";
import { popPersonId, tenantForRow } from "@/lib/demo-population-seed";
import { intentFor, type DayIntent } from "./policy";

// The agent behaviour layer.
//
// The generator writes rows. This LIVES days: for the reserved tail of the
// calendar it asks each fabricated person what they want to do, then puts that
// through the product's own machinery — the check-in routing rule, the safety
// gate engine — and records what came back, including the refusals.
//
// WHY IT MATTERS. Until now the strongest claim the demonstration could make
// about safety was that ten fixed scenarios replay correctly. That is a claim
// about ten inputs. What it could not say is that the gate engine had ever been
// run at population scale, because nothing in the seeded history had ever
// touched it: the generator wrote a check-in row and a safety event side by
// side and the engine was never asked whether the second followed from the
// first. Now the most recent fortnight of every person's history is a fortnight
// the engine actually saw, and a refusal on the console is a refusal the engine
// issued.
//
// WHAT IT IS NOT. It is not evidence about care. Every intent comes from rules
// in `policy.ts` that we wrote, so watching these agents teaches us our own
// rules. What it tests is the MACHINERY: whether a person who reports a harm
// urge is actually stopped, whether the refusal reaches the review queue,
// whether the metrics downstream count it.
//
// THE LEASH. It refuses to act for anybody whose provenance is not
// 'fabricated'. That check is here as well as in the database triggers,
// because an agent is the exact thing those triggers were written to stop and
// a guard at the gate is worth having even when the door is locked.

export interface AgentRunResult {
  people: number;
  days: number;
  checkIns: number;
  /** Days the person did not show up. Reported because a population that
   *  checks in every day is not a population, it is a cron job. */
  quietDays: number;
  measuresCompleted: number;
  measuresSkipped: number;
  measuresUndelivered: number;
  modulesOpened: number;
  sessionsStarted: number;
  /** THE HEADLINE. Session requests the gate engine refused BECAUSE A RULE
   *  FIRED, and the tier it refused them at. Every one of these is the
   *  product's safety machinery doing its job on a person who asked. */
  sessionsRefused: number;
  refusalsByTier: Record<string, number>;
  /** Session requests that got no further because the beta configuration has
   *  autonomous stimulation switched off — no rule fired and nothing about the
   *  person was decided. COUNTED SEPARATELY AND NOT WRITTEN TO THE LEDGER,
   *  because folding it into the line above would put a number on the console
   *  that reads as safety and is not, and because a per-person event for a
   *  global product setting would land on the clinical panel as that person's
   *  latest safety state. The trace for this one belongs in the configuration,
   *  which is where it already is. */
  sessionsUnavailable: number;
  /** Days the engine allowed nothing but grounding content. */
  groundingOnlyDays: number;
  /** Days the engine put the person below the top of the ladder, each one
   *  written to the ledger where a clinician can see it. */
  accessRestrictedDays: number;
  /** Every gate decision by ceiling, one per check-in. The gate runs on every
   *  check-in whether or not the person asked for anything, so this is the
   *  count that says how much of the population the engine actually saw. */
  tierDays: Record<string, number>;
  /** People skipped because they are not fabricated. Should always be zero in
   *  a demonstration environment, and is reported rather than assumed. */
  skippedNotFabricated: number;
  /** People whose check-in floor had to be filled, and the number of days it
   *  took. REPORTED, not hidden, because a floor is also the shape a masked
   *  defect takes: if the generator ever regresses, these numbers rise instead
   *  of the manifest staying green in silence. A handful is the tail of the
   *  calendar working as designed; dozens is a generator to go and look at. */
  checkInFloorPeople: number;
  checkInFloorDays: number;
}

const empty = (): AgentRunResult => ({
  people: 0, days: 0, checkIns: 0, quietDays: 0,
  measuresCompleted: 0, measuresSkipped: 0, measuresUndelivered: 0,
  modulesOpened: 0, sessionsStarted: 0, sessionsRefused: 0,
  refusalsByTier: {}, sessionsUnavailable: 0,
  groundingOnlyDays: 0, accessRestrictedDays: 0, tierDays: {}, skippedNotFabricated: 0,
  checkInFloorPeople: 0, checkInFloorDays: 0,
});

const dayDate = (epoch: Date, day: number) =>
  new Date(epoch.getTime() + day * 86400000).toISOString().slice(0, 10);

const dayStamp = (epoch: Date, day: number, hour: number) => {
  const t = new Date(epoch.getTime() + day * 86400000);
  t.setUTCHours(hour, 0, 0, 0);
  return t.toISOString().slice(0, 19).replace("T", " ");
};

/**
 * Live the reserved tail.
 *
 * SYNCHRONOUS over better-sqlite3, and inside one transaction, for the same
 * reason the generator is: five thousand person-days through an async client
 * would take minutes where p29 allows two for a whole reset. The domain
 * functions it calls — the routing rule and the gate engine — are pure and
 * synchronous, which is what makes this possible at all. The gate's INPUTS are
 * gathered here rather than through `gatherSafetyInputs`, because that reads
 * through the async client; the shape is the same and a guard checks the two
 * agree.
 */
export function runAgents(db: Database.Database, now = Date.now()): AgentRunResult {
  const out = empty();
  // IDEMPOTENT. Every id is derived from the profile, the kind and the day, and
  // every insert is conflict-do-nothing, so a second run writes nothing and a
  // reset lands in the same place. The counters still report what the run
  // WOULD have written, which is what makes them comparable across runs.
  out.days = AGENT_HORIZON;
  // `now` is a parameter so the day-rollover case can be exercised: a fault
  // that only appears after midnight is one no local run reproduces.
  const epoch = demoEpoch(now);

  const provenanceOf = db.prepare("SELECT provenance FROM persons WHERE id = ?");
  // What the generator left behind, counted strictly before the reserved tail
  // so the agents' own writes can never feed back into their floor decision.
  const agentWindowOpens = dayDate(epoch, GENERATED_DAYS);
  const countBefore = db.prepare(
    "SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND checkin_date < ?");
  const insCheckin = db.prepare(
    `INSERT INTO checkins (id, user_id, tenant_id, checkin_date, activation, shutdown,
       harm_urge, feels_safe, dissociation, sleep_quality, substance_flag,
       recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     -- CONFLICT ON THE ID, not on (user_id, checkin_date).
     --
     -- Both are unique, and choosing the wrong one broke the deployed
     -- demonstration the morning after this began running on every boot. The
     -- id is derived from the profile and the day OFFSET, which does not move;
     -- the checkin date comes from the demo epoch, which advances every day. So
     -- any later day the insert carried the same id and a different date, the
     -- date conflict did not match, and the primary key rejected it — aborting
     -- the whole population chain.
     --
     -- Conflicting on the id means these rows are written once and keep their
     -- dates. That is the right treatment for a record of something that
     -- happened: a check-in on the 3rd stays a check-in on the 3rd, and ages
     -- like every other row of seeded history. The operational feeds are
     -- re-dated instead, because a capacity feed is a snapshot of now rather
     -- than a record of then, and the two are different kinds of row.
     ON CONFLICT(id) DO NOTHING`);
  const insScreening = db.prepare(
    `INSERT INTO screenings (id, user_id, tenant_id, instrument, instrument_version,
       total_score, answers_json, risk_flags_json, created_at)
     VALUES (?, ?, ?, 'phq-9', 'standard', ?, '[]', '[]', ?)
     ON CONFLICT(id) DO NOTHING`);
  const insPractice = db.prepare(
    `INSERT INTO practice_completions (id, user_id, tenant_id, practice_id, practice_type,
       duration_sec, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`);
  const insSession = db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, tenant_id, module_id, status,
       pre_suds, post_suds, started_at, ended_at)
     VALUES (?, ?, ?, 'resourcing', 'completed', ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`);
  const insEvent = db.prepare(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id,
        actor_type, occurred_at, recorded_at, source_system, provenance,
        correlation_id, supersedes_event_id)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'demo-agent', ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`);

  const PROV = JSON.stringify({ fabricated: true, agent: true });

  db.transaction(() => {
    for (const row of MANIFEST) {
      const personId = popPersonId(row);
      const p = provenanceOf.get(personId) as { provenance: string } | undefined;
      // THE LEASH. An agent may only ever act for a fabricated person.
      if (!p || p.provenance !== "fabricated") { out.skippedNotFabricated += 1; continue; }

      out.people += 1;
      const tenant = tenantForRow(row);
      const seed = seedFor(row);
      const access = accessProfileFor(row);
      const exposure = exposureDaysFor(row);
      const startDay = enrolmentDayFor(row);
      const w = agentWindowFor(row);

      // DECIDE THE WHOLE WINDOW, THEN LIVE IT. Two passes rather than one,
      // because the floor below can only be applied once the person's whole
      // fortnight is known — and patching an intent before the day is written
      // is honest where writing a second check-in on top of a quiet day would
      // not be.
      const plan: Array<{ rel: number; absolute: number; intent: DayIntent }> = [];
      for (let rel = w.from; rel < w.to; rel++) {
        const absolute = startDay + rel;
        if (absolute < GENERATED_DAYS) continue;
        plan.push({ rel, absolute, intent: intentFor(row, rel, exposure, seed, access) });
      }

      // THE FLOOR.
      //
      // p14 states a check-in range per person and the quality manifest
      // enforces it, scaled to exposure — and the scaling has a floor of one,
      // because a person with three weeks of enrolment and no check-in at all
      // is a defect rather than a rounding result. Somebody who enrols in the
      // last fortnight of the calendar can hit that: their generated window is
      // a couple of days, the generator's start drag consumes it entirely, and
      // a probabilistic show-up rate can then hand them an agent window in
      // which they never appeared either. That person's whole life is in the
      // reserved tail, so the tail is what owes them their floor.
      //
      // It is measured against the TABLE — what the generator actually wrote —
      // rather than inferred from the length of the generated window, because
      // the two are not the same number and the difference between them is
      // precisely the case this is here for.
      //
      // The count is taken from BEFORE the agent window, so the decision does
      // not depend on whether the agents have already run: a second run reads
      // the same number and plans the same days.
      const need = scaledRange(TARGETS.checkins, exposure)[0];
      const before = Number((countBefore.get(personId, agentWindowOpens) as { n: number }).n);
      let have = before + plan.filter((d) => d.intent.checkIn !== null).length;
      let floored = false;
      // Latest first: a person who has been quiet all fortnight is more
      // plausibly somebody who has just come back than somebody who appeared
      // once at the start and vanished.
      for (let i = plan.length - 1; i >= 0 && have < need; i--) {
        if (plan[i].intent.checkIn !== null) continue;
        plan[i] = {
          ...plan[i],
          intent: { ...plan[i].intent, checkIn: floorCheckIn(row, plan[i].rel, exposure) },
        };
        have += 1;
        out.checkInFloorDays += 1;
        floored = true;
      }
      if (floored) out.checkInFloorPeople += 1;
      // The agents can only fill days they own. If a person is still short
      // after the whole fortnight has been spent, that is a generator defect
      // and the manifest is left to say so.

      for (const d of plan) {
        liveOneDay({
          row, personId, tenant, rel: d.rel, absolute: d.absolute, intent: d.intent, epoch, out,
          insCheckin, insScreening, insPractice, insSession, insEvent, PROV, db,
        });
      }
    }
  })();

  return out;
}

/** The one check-in a person who has appeared not at all must still have. Drawn
 *  from the same trajectory as any other day, so it is a quiet day rather than
 *  a manufactured one. */
function floorCheckIn(row: ManifestRow, day: number, exposure: number) {
  const forced = intentFor(row, day, exposure, seedFor(row) + 1);
  return forced.checkIn ?? {
    activation: 3, shutdown: 2, harmUrge: false, feelsSafe: true,
    dissociation: 1, sleepQuality: 6, substanceFlag: false,
  };
}

interface DayArgs {
  row: ManifestRow;
  personId: string;
  tenant: string;
  rel: number;
  absolute: number;
  intent: DayIntent;
  epoch: Date;
  out: AgentRunResult;
  insCheckin: Database.Statement;
  insScreening: Database.Statement;
  insPractice: Database.Statement;
  insSession: Database.Statement;
  insEvent: Database.Statement;
  PROV: string;
  db: Database.Database;
}

function liveOneDay(a: DayArgs) {
  const { row, personId, tenant, rel, absolute, intent, epoch, out } = a;
  const date = dayDate(epoch, absolute);

  if (intent.checkIn === null) {
    out.quietDays += 1;
  } else {
    const v = {
      activation: intent.checkIn.activation,
      shutdown: intent.checkIn.shutdown,
      harm_urge: intent.checkIn.harmUrge,
      feels_safe: intent.checkIn.feelsSafe,
      dissociation: intent.checkIn.dissociation,
      sleep_quality: intent.checkIn.sleepQuality,
      substance_flag: intent.checkIn.substanceFlag,
    };
    // THE PRODUCT'S OWN ROUTING RULE, not a copy of it. If somebody forks a
    // relaxed path for the demo, this population routes differently and the
    // reviewer's replay screen goes red on a page they are already looking at.
    const action = evaluateCheckin(v);
    const id = agentId(row.id, "checkin", rel);
    a.insCheckin.run(
      id, personId, tenant, date, v.activation, v.shutdown,
      v.harm_urge ? 1 : 0, v.feels_safe ? 1 : 0, v.dissociation, v.sleep_quality,
      v.substance_flag ? 1 : 0, action, dayStamp(epoch, absolute, 8));
    a.insEvent.run(
      agentId(row.id, "checkin-ev", rel), tenant, personId, "daily_checkin.completed",
      JSON.stringify({
        projectionId: id, checkinDate: date, ...v,
        harmUrge: v.harm_urge, feelsSafe: v.feels_safe, sleepQuality: v.sleep_quality,
        substanceFlag: v.substance_flag, recommendedAction: action,
        triggerIds: [], via: "web", fabricated: true,
      }),
      personId, "patient", dayStamp(epoch, absolute, 8), dayStamp(epoch, absolute, 8),
      a.PROV, null, null);
    out.checkIns += 1;

    // ── The gate ────────────────────────────────────────────────────────
    //
    // The same function a member's daily check-in calls, on this person's real
    // state. Its answer decides what follows, which is the whole reason this
    // layer exists: the generator wrote a session and a safety event side by
    // side and never asked whether the second followed from the first.
    const decision = evaluateAccess({
      nowMs: new Date(`${date}T09:00:00Z`).getTime(),
      dailyCheckin: {
        activation: v.activation,
        shutdown: v.shutdown,
        dissociation: v.dissociation,
        sleepQuality: v.sleep_quality,
        harmUrge: v.harm_urge,
        feelsSafe: v.feels_safe,
        substanceFlag: v.substance_flag,
      },
    });
    out.tierDays[decision.tierLabel] = (out.tierDays[decision.tierLabel] ?? 0) + 1;
    if (decision.groundingOnly) out.groundingOnlyDays += 1;

    // A RESTRICTION, recorded on the day it was issued.
    //
    // The gate runs on every check-in, and most days it says yes. On the days
    // it does not, it has lowered what this person may reach — and until this
    // was written, the only restricted days that left any trace were the few
    // where the person happened to also ask for a session. Twenty-five days of
    // restricted access were recorded as three. A clinician opening a chart
    // could not see that the engine sent somebody to crisis resources
    // yesterday, which is the single thing they would most want to know.
    //
    // Written from the tier rather than from the rules, because the tier is
    // what the person experienced. The rules are carried alongside it so the
    // reviewer can see why.
    if (decision.tier < AccessTier.STEADY) {
      a.insEvent.run(
        agentId(row.id, "restricted", rel), tenant, personId, "safety_state.changed",
        JSON.stringify({
          state: "access_restricted",
          reason: "gate_lowered_ceiling",
          tier: decision.tierLabel,
          rules: decision.hits.map((h) => h.id),
          memberReason: decision.primaryReason,
          fabricated: true,
        }),
        null, "system", dayStamp(epoch, absolute, 9), dayStamp(epoch, absolute, 9),
        a.PROV, null, null);
      out.accessRestrictedDays += 1;
    }

    if (intent.wantsSession) {
      if (decision.activatingSessionsAllowed) {
        const pre = Math.max(1, Math.min(10, v.activation));
        a.insSession.run(
          agentId(row.id, "session", rel), personId, tenant, pre,
          Math.max(0, pre - 1), dayStamp(epoch, absolute, 15), dayStamp(epoch, absolute, 16));
        out.sessionsStarted += 1;
      } else if (decision.hits.length === 0 && !decision.capabilities.stimulation) {
        // NOT A REFUSAL. No rule fired; the beta configuration simply does not
        // offer autonomous activating sessions yet. Counted, not recorded.
        //
        // The condition is written as "no rule fired AND stimulation is off"
        // rather than "stimulation is off", so that if the engine ever grows a
        // reason to refuse a person who also happens to be in this
        // configuration, that refusal is still written down.
        out.sessionsUnavailable += 1;
      } else {
        // A REFUSAL, recorded as an event so it reaches the review queue and
        // the metrics. A gate that says no and leaves no trace is a gate
        // nobody can audit.
        a.insEvent.run(
          agentId(row.id, "refused", rel), tenant, personId, "safety_state.changed",
          JSON.stringify({
            state: "session_refused",
            reason: "gate_refused_activating_session",
            tier: decision.tierLabel,
            // Every rule the engine fired, so a reviewer opening this event
            // sees WHY rather than only that it was refused.
            rules: decision.hits.map((h) => h.id),
            memberReason: decision.primaryReason,
            fabricated: true,
          }),
          null, "system", dayStamp(epoch, absolute, 15), dayStamp(epoch, absolute, 15),
          a.PROV, null, null);
        out.sessionsRefused += 1;
        out.refusalsByTier[decision.tierLabel] = (out.refusalsByTier[decision.tierLabel] ?? 0) + 1;
      }
    }

    if (intent.wantsModule && !decision.groundingOnly) {
      const kinds = ["grounding", "breathing", "learning", "preparation", "support"] as const;
      const kind = kinds[(rel + row.id.length) % kinds.length];
      a.insPractice.run(
        agentId(row.id, "practice", rel), personId, tenant, kind, kind,
        120 + (rel % 7) * 30, dayStamp(epoch, absolute, 10));
      out.modulesOpened += 1;
    }
  }

  // ── The measure, and the two sides of missing it ──────────────────────
  if (intent.measureDue) {
    if (!intent.measureDelivered) {
      a.insEvent.run(
        agentId(row.id, "undelivered", rel), tenant, personId, "measure.not_completed",
        JSON.stringify({
          instrument: "phq-9", dueOn: date, reason: "unavailable", cause: "service",
          mechanisms: accessProfileFor(row).mechanisms, fabricated: true,
        }),
        null, "system", dayStamp(epoch, absolute, 12), dayStamp(epoch, absolute, 12),
        a.PROV, null, null);
      a.out.measuresUndelivered += 1;
    } else if (!intent.completesMeasure) {
      a.insEvent.run(
        agentId(row.id, "skipped", rel), tenant, personId, "measure.not_completed",
        JSON.stringify({
          instrument: "phq-9", dueOn: date, reason: "skipped", cause: "person", fabricated: true,
        }),
        null, "system", dayStamp(epoch, absolute, 12), dayStamp(epoch, absolute, 12),
        a.PROV, null, null);
      a.out.measuresSkipped += 1;
    } else {
      a.insScreening.run(
        agentId(row.id, "measure", rel), personId, tenant,
        row.followUp, dayStamp(epoch, absolute, 12));
      a.out.measuresCompleted += 1;
    }
  }
}

/** Deterministic ids, so a second run inserts nothing new and a reset lands in
 *  the same place. Derived from the profile, the kind and the day rather than
 *  generated, for the same reason every other id in this population is: a
 *  random id makes the seeded environment unreproducible and its baseline hash
 *  meaningless. */
function agentId(profileId: string, kind: string, day: number): string {
  return `agent-${kind}-${profileId.toLowerCase()}-${day}`;
}
