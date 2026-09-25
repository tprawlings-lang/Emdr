// The evaluation tenant's synthetic caseload (Handoff 11 W1).
//
//   "Seed 3 BHMs, 1 psychiatric consultant, 2 PCPs, 1 leadership user, and
//    about 280 synthetic patients (about 95 per BHM) with 16 weeks of history
//    ... Deterministic seed so demos are repeatable. Synthetic names come from
//    an obviously synthetic list. No realistic DOBs, MRNs, or addresses."
//
// GENERIC, DRIVEN BY A PLAN. The engine knows nothing about any partner; the
// counts, names and mix are the tenant config's (EvaluationSeedPlan), so the
// next evaluation tenant is a new plan rather than a new generator.
//
// SAME CONTRACT AS THE DEMO GENERATOR (demo-population-generator.ts): it
// writes current-state rows — accounts, measures, check-ins, visits,
// assignments, alerts — and the genesis backfill derives the event ledger from
// them, so a replay reproduces what is here. Its seeded generator
// (StableRandom) is reused rather than a second one written.
//
// DETERMINISTIC. Ids and values depend only on the plan's version and each
// person's index; dates are offsets from the anchor day, so a reset on a given
// day produces the same caseload, and the queue always has something current
// in it. Two seeds with the same anchor are byte-identical (tested).
//
// OPT-IN AND ADDITIVE. The global demo reset does not run this, so the
// 240-person demo and every test that boots it are unchanged; this runs from
// `npm run seed:evolvedmd` and the /admin button, and its reset removes only
// this tenant's rows.
//
// WHAT IS NOT WRITTEN: no date of birth, no record number, no address, no safe
// person's contact — the tenant's PHI lock would refuse them anyway. Patients
// cannot sign in (their password is disabled); staff and the member testers
// can, with the evaluation password.

import type Database from "better-sqlite3";
import { hashPassword } from "../db";
import { ulidFrom } from "../ids";
import { evaluateCheckin } from "../gating";
import { StableRandom } from "../demo-population-generator";
import { DEMO_DATA_TABLES } from "../demo-reset";
import { ALERT_INSERT_SEEDED_SQL, alertValues, checkinSafetyAlert } from "../clinical/alert-create";
import type { TenantConfig } from "./types";

export type Presentation = "depression" | "anxiety" | "trauma";

/** Handoff 11 W1's required trajectories, plus the ordinary middle. */
export type Trajectory =
  | "early_responder" | "slow_responder" | "non_responder" | "dropout" | "measure_overdue"
  | "engaged_flat" | "disengaged_improving" | "typical";

export interface EvaluationSeedPlan {
  /** Changing it reshuffles every person, as a new dataset should. */
  version: string;
  weeks: number;
  /** One per care manager; the number of patients each carries. */
  careManagers: ReadonlyArray<{ name: string; patients: number }>;
  consultants: readonly string[];
  primaryCare: readonly string[];
  leadership: readonly string[];
  /** Member accounts for the partner's staff to try the app, one per care manager. */
  memberTesters: number;
  /** Shares of the caseload; they need not sum to exactly 1. */
  presentations: Record<Presentation, number>;
  trajectories: Record<Trajectory, number>;
  /** Share with no earlier behavioral health care. */
  newToCare: number;
}

export const EVAL_EMAIL_DOMAIN = "evaluation.invalid";

/** Adjectives and nouns no one is named. A name reads as a label at a glance. */
const FIRST = ["Amber", "Cobalt", "Juniper", "Linen", "Maple", "Onyx", "Quartz", "Russet", "Sable", "Teal", "Umber", "Willow"];
const SECOND = ["Harbor", "Meadow", "Ridge", "Brook", "Canyon", "Delta", "Grove", "Hollow", "Island", "Prairie", "Summit", "Valley"];

export function syntheticName(i: number): string {
  return `${FIRST[i % FIRST.length]} ${SECOND[Math.floor(i / FIRST.length) % SECOND.length]} ${String(i + 1).padStart(3, "0")}`;
}

const idFor = (plan: EvaluationSeedPlan, kind: string, key: string) => ulidFrom(0, `${plan.version}:${kind}:${key}`);

const DAY = 86_400_000;
const stamp = (anchor: Date, dayOffset: number, hour: number) =>
  new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()) + dayOffset * DAY + hour * 3_600_000)
    .toISOString().replace("T", " ").slice(0, 19);
const date = (anchor: Date, dayOffset: number) => stamp(anchor, dayOffset, 0).slice(0, 10);

function pickWeighted<T extends string>(rng: StableRandom, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as Array<[T, number]>;
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng.next() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}

/** Pure. The fraction of baseline a score sits at, `weeks` into care. */
export function curve(t: Trajectory, weeks: number): number {
  const w = Math.max(0, weeks);
  switch (t) {
    case "early_responder": return w <= 6 ? 1 - 0.6 * (w / 6) : Math.max(0.15, 0.4 - 0.03 * (w - 6));
    case "slow_responder": return Math.max(0.4, 1 - 0.042 * w);
    case "non_responder": return 1 - 0.012 * w;
    case "dropout": return 1 - 0.04 * w;
    case "measure_overdue": return Math.max(0.5, 1 - 0.035 * w);
    case "engaged_flat": return 0.95;
    case "disengaged_improving": return Math.max(0.25, 1 - 0.07 * w);
    case "typical": return Math.max(0.45, 1 - 0.035 * w);
  }
}

/** Spread a total over items (0 to 3 each), deterministically. Item 9 of the
 *  PHQ-9 is held at `item9` so a positive answer is a deliberate act. */
function items(total: number, count: number, rng: StableRandom, item9?: number): number[] {
  const out = Array(count).fill(0);
  let left = Math.max(0, Math.min(total - (item9 ?? 0), (count - (item9 === undefined ? 0 : 1)) * 3));
  const open = [...Array(count).keys()].filter((i) => !(item9 !== undefined && i === 8));
  while (left > 0) {
    const i = open[rng.int(0, open.length - 1)];
    if (out[i] < 3) { out[i]++; left--; }
  }
  if (item9 !== undefined) out[8] = item9;
  return out;
}

/** The staff and tester password when EMDR_EVAL_PASSWORD is unset. Synthetic
 *  accounts in a tenant that refuses PHI; set the variable on any shared host. */
export const DEFAULT_EVAL_PASSWORD = "evaluation1234";

export interface SeedCounts {
  staff: number; patients: number; testers: number; measures: number; checkins: number;
  visits: number; alerts: number; byTrajectory: Record<string, number>;
}

/** Who was seeded as what, for the tests and the logins doc. Returned, never
 *  stored: a queue that read a stored trajectory would be reading the answer
 *  key rather than the data. */
export interface SeedRosterEntry { id: string; index: number; trajectory: Trajectory; item9: boolean; crisis: boolean }

export interface SeedResult extends SeedCounts { roster: SeedRosterEntry[] }

/** Write the caseload. Idempotent per plan version: a second call with the
 *  tenant already seeded changes nothing (reset first to rebuild). */
export function seedEvaluationTenant(
  db: Database.Database, config: TenantConfig, plan: EvaluationSeedPlan, anchor: Date,
  password = process.env.EMDR_EVAL_PASSWORD ?? DEFAULT_EVAL_PASSWORD
): SeedResult {
  const counts: SeedResult = { staff: 0, patients: 0, testers: 0, measures: 0, checkins: 0, visits: 0, alerts: 0, byTrajectory: {}, roster: [] };
  const T = config.id;
  const already = db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?").get(T) as { n: number };
  if (already.n > 0) return counts;

  const history = plan.weeks * 7;
  const staffHash = hashPassword(password);

  const insTenant = db.prepare(
    `INSERT INTO tenants (id, kind, name, mode) VALUES (?, 'organization', ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, mode = excluded.mode`);
  // Every timestamp is written, never left to the clock, so two seeds on the
  // same day are identical (tested).
  const insPerson = db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance, created_at, updated_at) VALUES (?, ?, ?, 'fabricated', ?, ?)");
  const insUser = db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insRole = db.prepare(
    `INSERT INTO role_assignments (id, person_id, tenant_id, role, scope, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(person_id, tenant_id, role) DO NOTHING`);
  const insConsent = db.prepare(
    "INSERT INTO consents (id, user_id, tenant_id, policy_version, scope, granted_at) VALUES (?, ?, ?, 'evaluation-consent-v1', ?, ?)");
  // Membership without billing: an evaluation tenant is not charged, and a
  // member tester must not meet the paywall (found in package 1).
  const insSub = db.prepare(
    `INSERT INTO subscriptions (user_id, tenant_id, plan, status, price_cents, currency, provider, current_period_end, created_at, updated_at)
     VALUES (@id, @t, 'monthly', 'active', 0, 'usd', 'evaluation', @end, @at, @at)`);
  const insProfile = db.prepare(
    `INSERT INTO user_profiles (user_id, tenant_id, therapist_status, emdr_experience, goals_json, trauma_areas_json,
       restricted_topics_json, profile_complete, created_at, updated_at)
     VALUES (@id, @t, @status, 'none', '[]', '[]', '[]', 1, @at, @at)`);
  const insTrack = db.prepare("INSERT INTO care_tracks (id, user_id, tenant_id, track_id, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)");
  const insAssign = db.prepare(
    `INSERT INTO caseload_assignments (id, tenant_id, person_id, clinician_person_id, assigned_by, reason, started_at)
     VALUES (?, ?, ?, ?, NULL, 'Synthetic evaluation caseload.', ?)`);
  const insPcp = db.prepare(
    "INSERT INTO primary_care_links (id, tenant_id, pcp_person_id, person_id, started_at) VALUES (?, ?, ?, ?, ?)");
  const insScreening = db.prepare(
    `INSERT INTO screenings (id, user_id, tenant_id, instrument, instrument_version, total_score, answers_json, risk_flags_json, created_at)
     VALUES (?, ?, ?, ?, 'standard', ?, ?, ?, ?)`);
  const insCheckin = db.prepare(
    `INSERT INTO checkins (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation,
       sleep_quality, substance_flag, recommended_action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?)`);
  const insVisit = db.prepare(
    `INSERT INTO care_visits (id, tenant_id, person_id, clinician_person_id, kind, minutes, scheduled_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // The shared alert statement (alert-create.ts), so the wording and columns
  // are the product's own; the tenant comes from the person (inherit.ts).
  const insAlertRow = db.prepare(ALERT_INSERT_SEEDED_SQL);
  const insAlert = (a: Parameters<typeof alertValues>[0], at: string) => insAlertRow.run(...alertValues(a), "open", null, null, at, null);

  const run = db.transaction(() => {
    insTenant.run(T, config.displayName, config.mode);

    const staff = (kind: string, name: string, role: string, scope: string | null, i: number) => {
      const id = idFor(plan, "staff", `${kind}:${i}`);
      const slug = `${kind}.${name.toLowerCase().replace(/[^a-z]+/g, "")}`;
      const at = stamp(anchor, -history - 7, 9);
      insPerson.run(id, T, `${name} (synthetic)`, at, at);
      insUser.run(id, T, `${slug}@${EVAL_EMAIL_DOMAIN}`, staffHash, role, `${name} (synthetic)`, at);
      if (scope) insRole.run(idFor(plan, "role", `${kind}:${i}`), id, T, kind === "bhm" ? "care_manager" : role, scope, at, at);
      counts.staff++;
      return id;
    };
    // Care managers sign in as clinicians and hold care_manager on their
    // caseload: Handoff 11 maps them to care_manager, which here is a care
    // relationship rather than a login (package 1).
    const managers = plan.careManagers.map((m, i) => staff("bhm", m.name, "clinician", "caseload", i));
    plan.consultants.forEach((n, i) => staff("consultant", n, "clinician", "consult", i));
    const pcps = plan.primaryCare.map((n, i) => staff("pcp", n, "pcp_viewer", null, i));
    plan.leadership.forEach((n, i) => staff("leadership", n, "organization", null, i));

    // ── Member testers: the partner's staff trying the app themselves. A
    // membership and a care manager; everything else they do themselves.
    for (let i = 0; i < plan.memberTesters; i++) {
      const id = idFor(plan, "tester", String(i));
      const name = `Member Tester ${i + 1} (synthetic)`;
      const at = stamp(anchor, -1, 9);
      insPerson.run(id, T, name, at, at);
      insUser.run(id, T, `tester${i + 1}@${EVAL_EMAIL_DOMAIN}`, staffHash, "member", name, at);
      insSub.run({ id, t: T, end: stamp(anchor, 365, 0), at });
      insAssign.run(idFor(plan, "assign", `tester:${i}`), T, id, managers[i % managers.length], stamp(anchor, -1, 9));
      counts.testers++;
    }

    // ── Patients ──────────────────────────────────────────────────────────
    let index = 0;
    const special = { item9: -1, crisis: -1 };
    plan.careManagers.forEach((m, mi) => {
      for (let k = 0; k < m.patients; k++, index++) {
        const rng = new StableRandom(index + 1, plan.version);
        const id = idFor(plan, "patient", String(index));
        const name = syntheticName(index);
        const presentation = pickWeighted(rng, plan.presentations);
        const trajectory = pickWeighted(rng, plan.trajectories);
        // The two single cases W1 names, placed deterministically on the
        // first eligible people so each exists exactly once.
        const isItem9 = special.item9 < 0 && trajectory === "slow_responder";
        if (isItem9) special.item9 = index;
        const isCrisis = !isItem9 && special.crisis < 0 && trajectory === "typical";
        if (isCrisis) special.crisis = index;
        // Enrolment: a rolling intake over the window, constrained where the
        // trajectory is only visible after enough weeks.
        // Non-responders are past week 10; a dropout left three to five weeks
        // in and has been quiet for more than 14 days; an overdue member has
        // answered at least twice before stopping 22 to 35 days ago.
        const latest = trajectory === "non_responder" ? history - 77
          : trajectory === "dropout" || trajectory === "measure_overdue" ? history - 63
          : trajectory === "early_responder" || trajectory === "slow_responder" ? history - 42
          : history - 21;
        const enrol = -history + rng.int(0, Math.max(0, latest));
        counts.byTrajectory[trajectory] = (counts.byTrajectory[trajectory] ?? 0) + 1;
        counts.roster.push({ id, index, trajectory, item9: isItem9, crisis: isCrisis });

        insPerson.run(id, T, name, stamp(anchor, enrol, 8), stamp(anchor, enrol, 8));
        insUser.run(id, T, `patient-${String(index + 1).padStart(3, "0")}@${EVAL_EMAIL_DOMAIN}`, "!", "member", name, stamp(anchor, enrol, 8));
        for (const scope of ["care_program_full", "measurement"]) insConsent.run(idFor(plan, "consent", `${index}:${scope}`), id, T, scope, stamp(anchor, enrol, 8));
        insSub.run({ id, t: T, end: stamp(anchor, 365, 0), at: stamp(anchor, enrol, 8) });
        insProfile.run({ id, t: T, status: rng.chance(plan.newToCare) ? "none" : "past", at: stamp(anchor, enrol, 8) });
        insTrack.run(idFor(plan, "track", String(index)), id, T,
          presentation === "depression" ? "depression_adjunct" : presentation === "anxiety" ? "anxiety_panic" : "ptsd_trauma", stamp(anchor, enrol, 8));
        insAssign.run(idFor(plan, "assign", String(index)), T, id, managers[mi], stamp(anchor, enrol, 9));
        insPcp.run(idFor(plan, "pcp", String(index)), T, pcps[index % pcps.length], id, stamp(anchor, enrol, 9));

        // Where the person stops: a dropout leaves; an overdue member keeps
        // using the app but stops answering measures 3 to 5 weeks ago.
        const stopMeasures = trajectory === "dropout" ? enrol + rng.int(3, 5) * 7
          : trajectory === "measure_overdue" ? -rng.int(22, 35) : 0;
        const stopActivity = trajectory === "dropout" ? stopMeasures + rng.int(0, 5) : 0;
        const basePhq = presentation === "depression" ? rng.int(13, 22) : presentation === "anxiety" ? rng.int(8, 15) : rng.int(11, 18);
        const baseGad = presentation === "anxiety" ? rng.int(12, 19) : presentation === "depression" ? rng.int(7, 13) : rng.int(10, 16);

        // ── PHQ-9 and GAD-7 on the tenant's cadence, from enrolment.
        const cadence = config.measures.phq9.cadenceDays;
        for (let day = enrol; day <= 0; day += cadence) {
          if (stopMeasures && day > stopMeasures) break;
          const weeks = (day - enrol) / 7;
          const f = curve(trajectory, weeks);
          const phq = Math.max(0, Math.min(27, Math.round(basePhq * f + rng.int(-2, 2))));
          const gad = Math.max(0, Math.min(21, Math.round(baseGad * f + rng.int(-2, 2))));
          const newest = day + cadence > 0;
          const item9 = isItem9 && newest ? 1 : 0;
          const phqItems = items(Math.max(phq, item9), 9, rng, item9);
          const flags = item9 > 0 ? JSON.stringify(["suicidal_ideation_screen_positive"]) : "[]";
          insScreening.run(idFor(plan, "phq9", `${index}:${day}`), id, T, "phq-9", phqItems.reduce((a, b) => a + b, 0), JSON.stringify(phqItems), flags, stamp(anchor, day, 10));
          const gadItems = items(gad, 7, rng);
          insScreening.run(idFor(plan, "gad7", `${index}:${day}`), id, T, "gad-7", gadItems.reduce((a, b) => a + b, 0), JSON.stringify(gadItems), "[]", stamp(anchor, day, 10));
          counts.measures += 2;
          if (item9 > 0) {
            insAlert({ id: idFor(plan, "alert", `${index}:item9`), userId: id, type: "screening_risk_item", severity: "urgent",
              detail: `phq-9: suicidal_ideation_screen_positive (total ${phqItems.reduce((a, b) => a + b, 0)})` }, stamp(anchor, day, 10));
            counts.alerts++;
          }
        }

        // ── App activity. High engagement with flat scores, and the reverse,
        // are the two W1 names; a dropout goes quiet, which W2 reads as "no
        // activity in 14 days after being active".
        const perWeek = trajectory === "engaged_flat" ? 5.5 : trajectory === "disengaged_improving" ? 0.3
          : trajectory === "dropout" ? 2 : rng.int(1, 4);
        const end = stopActivity ? Math.min(0, stopActivity) : 0;
        for (let day = enrol + 1; day <= end; day++) {
          if (!rng.chance(perWeek / 7)) continue;
          const weeks = (day - enrol) / 7;
          const level = curve(trajectory, weeks) * basePhq / 27;
          const c = {
            activation: Math.max(0, Math.min(10, Math.round(level * 8 + rng.int(-1, 1)))),
            shutdown: Math.max(0, Math.min(10, Math.round(level * 6 + rng.int(-1, 1)))),
            harm_urge: false, feels_safe: true,
            dissociation: Math.max(0, Math.min(10, rng.int(0, 3))),
            sleep_quality: Math.max(0, Math.min(10, Math.round(8 - level * 5 + rng.int(-1, 1)))),
            substance_flag: false,
          };
          insCheckin.run(idFor(plan, "checkin", `${index}:${day}`), id, T, date(anchor, day), c.activation, c.shutdown, 1,
            c.dissociation, c.sleep_quality, evaluateCheckin(c), stamp(anchor, day, 20));
          counts.checkins++;
        }
        if (isCrisis) {
          // The one crisis-script event: a check-in two days ago saying they
          // did not feel safe, routed to the crisis page, with its alert.
          insCheckin.run(idFor(plan, "checkin", `${index}:crisis`), id, T, date(anchor, -2), 6, 5, 0, 2, 3,
            "crisis", stamp(anchor, -2, 21));
          insAlert(checkinSafetyAlert({ id: idFor(plan, "alert", `${index}:crisis`), userId: id, harmUrge: false }), stamp(anchor, -2, 21));
          counts.checkins++; counts.alerts++;
        }

        // ── Visits: a monthly 45-minute visit and a 15-minute check-up
        // between, from enrolment; completed in the past, the next one
        // scheduled. A dropout's visits after they left were missed.
        for (let day = enrol, n = 0; day <= 35; day += 14, n++) {
          const kind = n % 2 === 0 ? "visit" : "checkup";
          const past = day < 0;
          const status = !past ? "scheduled" : stopActivity && day > stopActivity ? "missed" : "completed";
          if (!past && day > 30) break;
          insVisit.run(idFor(plan, "visit", `${index}:${n}`), T, id, managers[mi], kind, kind === "visit" ? 45 : 15,
            stamp(anchor, day, 9 + (index % 8)), status, stamp(anchor, Math.min(day, 0) - 14, 9));
          counts.visits++;
          if (!past) break;
        }
        counts.patients++;
      }
    });
  });
  run();
  return counts;
}

/** Remove this tenant's rows and nothing else, in the demo reset's own
 *  foreign-key-safe order. Rows that carry the tenant are matched on it; rows
 *  that only point at a person (identity backfill writes some under the
 *  platform tenant) are matched on the tenant's people. */
export function resetEvaluationTenant(db: Database.Database, tenantId: string): Record<string, number> {
  const people = (db.prepare("SELECT id FROM persons WHERE tenant_id = ? UNION SELECT id FROM users WHERE tenant_id = ?").all(tenantId, tenantId) as Array<{ id: string }>).map((r) => r.id);
  const deleted: Record<string, number> = {};
  const run = db.transaction(() => {
    db.prepare("CREATE TEMP TABLE IF NOT EXISTS eval_people (id TEXT PRIMARY KEY)").run();
    db.prepare("DELETE FROM eval_people").run();
    const ins = db.prepare("INSERT OR IGNORE INTO eval_people (id) VALUES (?)");
    for (const id of people) ins.run(id);
    for (const table of DEMO_DATA_TABLES) {
      const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
      const where: string[] = [];
      if (cols.has("tenant_id")) where.push("tenant_id = @t");
      for (const c of ["person_id", "user_id", "clinician_person_id", "pcp_person_id"]) {
        if (cols.has(c)) where.push(`${c} IN (SELECT id FROM eval_people)`);
      }
      if (table === "users" || table === "persons") where.push("id IN (SELECT id FROM eval_people)");
      if (where.length === 0) continue;
      const { changes } = db.prepare(`DELETE FROM ${table} WHERE ${where.join(" OR ")}`).run({ t: tenantId });
      if (changes > 0) deleted[table] = changes;
    }
    db.prepare("DELETE FROM eval_people").run();
  });
  run();
  return deleted;
}
