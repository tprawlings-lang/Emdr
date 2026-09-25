// Handoff 11 package 2 (W1): the evaluation tenant's synthetic caseload and
// its reset.
//
//   "Seed 3 BHMs, 1 psychiatric consultant, 2 PCPs, 1 leadership user, and
//    about 280 synthetic patients (about 95 per BHM) with 16 weeks of history
//    ... Trajectories must cover ... Deterministic seed so demos are
//    repeatable. Synthetic names ... No realistic DOBs, MRNs, or addresses."
//
// Each claim is read back from the rows written, not from the generator's own
// counts, so a generator that says it wrote something it did not fails here.

process.env.EMDR_DATA_DIR = `/tmp/steady-eval-seed-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "evaluation-seed-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "evaluation-seed-key";
delete process.env.EMDR_EVAL_PASSWORD;

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID, TENANT_SCOPED_TABLES, verifyPassword } from "../src/lib/db";
import { DEMO_DATA_TABLES } from "../src/lib/demo-reset";
import {
  curve, DEFAULT_EVAL_PASSWORD, EVAL_EMAIL_DOMAIN, resetEvaluationTenant, seedEvaluationTenant, syntheticName,
  type SeedResult, type Trajectory,
} from "../src/lib/tenants/evaluation-seed";
import {
  EVALUATION_PLANS, EvaluationRefused, evaluationLogins, evaluationPasswordHint, evaluationStatus, rebuildEvaluationTenant,
} from "../src/lib/tenants/evaluation-admin";
import { EVOLVEDMD_SEED_PLAN, EVOLVEDMD_TENANT } from "../src/lib/tenants/evolvedmd";
import { PHI_FIELDS } from "../src/lib/tenants/phi";
import { subscriptionActive } from "../src/lib/billing";
import { verifyProjections } from "../src/lib/projections";

const db = getDb();
const T = EVOLVEDMD_TENANT.id;
const ANCHOR = new Date("2026-09-25T12:00:00Z");
const DAY = 86_400_000;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/** Every row in every data table that belongs to the tenant or its people,
 *  in a stable order, so two seeds can be compared exactly. */
function snapshot(): string {
  const out: string[] = [];
  const people = "(SELECT id FROM users WHERE tenant_id = @t UNION SELECT id FROM persons WHERE tenant_id = @t)";
  for (const table of DEMO_DATA_TABLES) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
    const where: string[] = [];
    if (cols.has("tenant_id")) where.push("tenant_id = @t");
    for (const c of ["person_id", "user_id", "clinician_person_id", "pcp_person_id"]) if (cols.has(c)) where.push(`${c} IN ${people}`);
    if (where.length === 0) continue;
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where.join(" OR ")}`).all({ t: T }) as Array<Record<string, unknown>>;
    // A password hash is salted, so it differs by design; everything else must not.
    const cleaned = rows.map((r) => JSON.stringify({ ...r, password_hash: r.password_hash === "!" ? "!" : r.password_hash ? "hash" : undefined }));
    out.push(`${table}:${cleaned.sort().join("\n")}`);
  }
  return out.join("\n\n");
}

function seed(): SeedResult {
  return seedEvaluationTenant(db, EVOLVEDMD_TENANT, EVOLVEDMD_SEED_PLAN, ANCHOR);
}

function dayOf(ts: string): number {
  const d = new Date(ts.replace(" ", "T") + "Z").getTime();
  const a = Date.UTC(ANCHOR.getUTCFullYear(), ANCHOR.getUTCMonth(), ANCHOR.getUTCDate());
  return Math.floor((d - a) / DAY);
}

// A person outside the tenant, with ordinary rows, so the reset can be shown
// to leave everybody else alone.
const outsider = newId();
db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Outside', 'fabricated')").run(outsider, PLATFORM_TENANT_ID);
db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, 'outside@synthetic.test', 'x', 'member', 'Outside')").run(outsider, PLATFORM_TENANT_ID);
db.prepare("INSERT INTO checkins (id, user_id, tenant_id, checkin_date, activation, shutdown, harm_urge, feels_safe, dissociation, sleep_quality, substance_flag, recommended_action) VALUES (?, ?, ?, '2026-09-20', 3, 3, 0, 1, 1, 6, 0, 'continue')")
  .run(newId(), outsider, PLATFORM_TENANT_ID);

function outsideCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of DEMO_DATA_TABLES) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
    if (!cols.has("tenant_id")) continue;
    out[table] = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id <> ?`).get(T) as { n: number }).n;
  }
  return out;
}

let result: SeedResult;
const before = outsideCounts();

test("the same plan and day give the same caseload, row for row", async () => {
  const first = seed();
  const a = snapshot();
  // Across a second boundary, so a column left to CURRENT_TIMESTAMP shows.
  await new Promise((r) => setTimeout(r, 1100));
  resetEvaluationTenant(db, T);
  result = seed();
  assert.equal(snapshot(), a);
  assert.deepEqual({ ...first, roster: first.roster.length }, { ...result, roster: result.roster.length });
  // A second seed over a seeded tenant changes nothing.
  assert.equal(seed().patients, 0);
  assert.equal(snapshot(), a);
});

test("the cast: three care managers with their caseloads, a consultant, two primary care providers, leadership, testers", () => {
  const byRole = db.prepare("SELECT role, COUNT(*) AS n FROM users WHERE tenant_id = ? GROUP BY role").all(T) as Array<{ role: string; n: number }>;
  const roles = Object.fromEntries(byRole.map((r) => [r.role, r.n]));
  assert.deepEqual(roles, { clinician: 4, pcp_viewer: 2, organization: 1, member: 283 });
  const managers = db.prepare(
    `SELECT u.email, COUNT(c.id) AS n FROM role_assignments r JOIN users u ON u.id = r.person_id
       JOIN caseload_assignments c ON c.clinician_person_id = u.id AND c.ended_at IS NULL
      WHERE r.tenant_id = ? AND r.role = 'care_manager' AND r.scope = 'caseload'
        AND c.person_id IN (SELECT id FROM users WHERE tenant_id = ? AND password_hash = '!')
      GROUP BY u.email ORDER BY u.email`
  ).all(T, T) as Array<{ email: string; n: number }>;
  assert.deepEqual(managers.map((m) => m.n), [95, 93, 92], "the care managers do not carry about 95 each");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM role_assignments WHERE tenant_id = ? AND role = 'clinician' AND scope = 'consult'").get(T) as { n: number }).n, 1);
  // Every patient has a primary care provider, and it is one of the two.
  const pcpLinks = db.prepare(
    `SELECT COUNT(DISTINCT l.person_id) AS patients, COUNT(DISTINCT l.pcp_person_id) AS pcps FROM primary_care_links l
      JOIN users p ON p.id = l.pcp_person_id AND p.role = 'pcp_viewer' WHERE l.tenant_id = ?`
  ).get(T) as { patients: number; pcps: number };
  assert.deepEqual(pcpLinks, { patients: 280, pcps: 2 });
  // Staff and testers sign in with the evaluation password; patients cannot.
  for (const l of evaluationLogins(T)) {
    const row = db.prepare("SELECT password_hash FROM users WHERE email = ?").get(l.email) as { password_hash: string };
    assert.ok(verifyPassword(DEFAULT_EVAL_PASSWORD, row.password_hash), l.email);
  }
  assert.equal(evaluationLogins(T).length, 10);
  assert.match(evaluationPasswordHint(), /evaluation1234/);
  assert.deepEqual(evaluationStatus(T), { seeded: true, staff: 7, patients: 280, historyTo: "2026-09-25" });
});

test("sixteen weeks of history, on the tenant's measure cadence", () => {
  const span = db.prepare("SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM screenings WHERE tenant_id = ?").get(T) as { first: string; last: string };
  assert.equal(dayOf(span.first), -EVOLVEDMD_SEED_PLAN.weeks * 7);
  assert.ok(dayOf(span.last) <= 0);
  const cadence = EVOLVEDMD_TENANT.measures.phq9.cadenceDays;
  const gaps = db.prepare(
    `SELECT user_id, created_at FROM screenings WHERE tenant_id = ? AND instrument = 'phq-9' ORDER BY user_id, created_at`
  ).all(T) as Array<{ user_id: string; created_at: string }>;
  for (let i = 1; i < gaps.length; i++) {
    if (gaps[i].user_id !== gaps[i - 1].user_id) continue;
    assert.equal(dayOf(gaps[i].created_at) - dayOf(gaps[i - 1].created_at), cadence);
  }
  // Mostly depression and anxiety, a minority trauma, most new to care.
  const tracks = Object.fromEntries((db.prepare("SELECT track_id, COUNT(*) AS n FROM care_tracks WHERE tenant_id = ? GROUP BY track_id").all(T) as Array<{ track_id: string; n: number }>).map((r) => [r.track_id, r.n]));
  assert.ok(tracks.ptsd_trauma > 0 && tracks.ptsd_trauma < tracks.depression_adjunct && tracks.ptsd_trauma < tracks.anxiety_panic, JSON.stringify(tracks));
  const newToCare = db.prepare("SELECT AVG(therapist_status = 'none') AS share FROM user_profiles WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ? AND password_hash = '!')").get(T) as { share: number };
  assert.ok(newToCare.share > 0.6, `new to care ${newToCare.share}`);
});

/** The latest two PHQ-9 totals and the first, per patient. */
function phq(id: string): { first: number; latest: number; latestDay: number; firstDay: number } {
  const rows = db.prepare("SELECT total_score, created_at FROM screenings WHERE user_id = ? AND instrument = 'phq-9' ORDER BY created_at").all(id) as Array<{ total_score: number; created_at: string }>;
  return { first: rows[0].total_score, latest: rows[rows.length - 1].total_score, firstDay: dayOf(rows[0].created_at), latestDay: dayOf(rows[rows.length - 1].created_at) };
}
const lastCheckin = (id: string) => (db.prepare("SELECT MAX(checkin_date) AS d FROM checkins WHERE user_id = ?").get(id) as { d: string | null }).d;
const checkinsPerWeek = (id: string) => {
  const { n, first } = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS first FROM checkins WHERE user_id = ?").get(id) as { n: number; first: string | null };
  return first ? n / Math.max(1, -dayOf(first) / 7) : 0;
};
const of = (t: Trajectory) => result.roster.filter((r) => r.trajectory === t);

test("every trajectory W1 names is there, and each looks like itself in the data", () => {
  const all: Trajectory[] = ["early_responder", "slow_responder", "non_responder", "dropout", "measure_overdue", "engaged_flat", "disengaged_improving", "typical"];
  for (const t of all) assert.ok(of(t).length >= 5, `${t}: ${of(t).length}`);
  assert.equal(result.roster.length, 280);

  // Non-responders: past week 10, less than half the way down.
  for (const r of of("non_responder")) {
    const p = phq(r.id);
    assert.ok(-p.firstDay / 7 > 10, "a non-responder is not yet past week 10");
    assert.ok(p.latest > p.first * 0.5, `non-responder ${r.index} responded (${p.first} → ${p.latest})`);
  }
  // Early responders: at least half the way down by now.
  const early = of("early_responder").filter((r) => { const p = phq(r.id); return p.latest <= p.first * 0.5; });
  assert.ok(early.length >= of("early_responder").length * 0.8, "early responders have not responded");
  // Dropouts: active once, quiet for more than 14 days, measures stopped.
  for (const r of of("dropout")) {
    const d = lastCheckin(r.id);
    assert.ok(d, `dropout ${r.index} was never active`);
    assert.ok(dayOf(`${d} 00:00:00`) < -14, `dropout ${r.index} is not quiet`);
    assert.ok(phq(r.id).latestDay < -14);
  }
  // Measure overdue: answered at least twice, then nothing for longer than
  // the cadence plus seven days — while still using the app.
  const cadence = EVOLVEDMD_TENANT.measures.phq9.cadenceDays;
  for (const r of of("measure_overdue")) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM screenings WHERE user_id = ? AND instrument = 'phq-9'").get(r.id) as { n: number }).n;
    assert.ok(n >= 2, `overdue ${r.index} answered ${n} time(s)`);
    assert.ok(-phq(r.id).latestDay > cadence + 7, `overdue ${r.index} is not overdue`);
  }
  const recent = of("measure_overdue").filter((r) => { const d = lastCheckin(r.id); return d && dayOf(`${d} 00:00:00`) >= -7; });
  assert.ok(recent.length >= of("measure_overdue").length * 0.8, "overdue members stopped using the app too");
  // High engagement with flat scores, and low engagement with good scores.
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const engaged = avg(of("engaged_flat").map((r) => checkinsPerWeek(r.id)));
  const disengaged = avg(of("disengaged_improving").map((r) => checkinsPerWeek(r.id)));
  const typical = avg(of("typical").map((r) => checkinsPerWeek(r.id)));
  assert.ok(engaged > typical && typical > disengaged, `${engaged} / ${typical} / ${disengaged}`);
  for (const r of of("engaged_flat")) { const p = phq(r.id); assert.ok(p.latest > p.first * 0.5, "an engaged-flat member responded"); }
  const improved = of("disengaged_improving").filter((r) => { const p = phq(r.id); return p.latest < p.first; });
  assert.ok(improved.length >= of("disengaged_improving").length * 0.8, "disengaged members are not improving");
});

test("exactly one PHQ-9 item 9 positive and one crisis-script event, each with its alert", () => {
  const positives = db.prepare(
    `SELECT user_id, answers_json, risk_flags_json, created_at FROM screenings WHERE tenant_id = ? AND instrument = 'phq-9'
      AND json_extract(answers_json, '$[8]') > 0`
  ).all(T) as Array<{ user_id: string; answers_json: string; risk_flags_json: string; created_at: string }>;
  assert.equal(positives.length, 1);
  assert.deepEqual(JSON.parse(positives[0].risk_flags_json), ["suicidal_ideation_screen_positive"]);
  assert.ok(dayOf(positives[0].created_at) > -14, "the item 9 positive is not recent enough to be in a queue");
  assert.equal(result.roster.filter((r) => r.item9).map((r) => r.id)[0], positives[0].user_id);

  const crisis = db.prepare("SELECT user_id, feels_safe, recommended_action FROM checkins WHERE tenant_id = ? AND recommended_action = 'crisis'").all(T) as Array<{ user_id: string; feels_safe: number }>;
  assert.equal(crisis.length, 1);
  assert.equal(crisis[0].feels_safe, 0);
  assert.equal(result.roster.filter((r) => r.crisis).map((r) => r.id)[0], crisis[0].user_id);
  assert.notEqual(crisis[0].user_id, positives[0].user_id, "the two cases should be two people");

  const alerts = db.prepare("SELECT user_id, alert_type FROM alerts WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?) ORDER BY alert_type").all(T);
  assert.deepEqual(alerts, [
    { user_id: crisis[0].user_id, alert_type: "checkin_safety_positive" },
    { user_id: positives[0].user_id, alert_type: "screening_risk_item" },
  ]);
  // No other check-in in the tenant routes anywhere but ordinary care.
  const worse = db.prepare("SELECT COUNT(*) AS n FROM checkins WHERE tenant_id = ? AND (harm_urge = 1 OR feels_safe = 0)").get(T) as { n: number };
  assert.equal(worse.n, 1);
});

test("visits: a 45-minute visit and a 15-minute check-up, alternating, the next one scheduled", () => {
  const kinds = db.prepare("SELECT kind, minutes, COUNT(*) AS n FROM care_visits WHERE tenant_id = ? GROUP BY kind, minutes ORDER BY kind").all(T) as Array<{ kind: string; minutes: number }>;
  assert.deepEqual(kinds.map((k) => [k.kind, k.minutes]), [["checkup", 15], ["visit", 45]]);
  const upcoming = db.prepare("SELECT COUNT(DISTINCT person_id) AS n FROM care_visits WHERE tenant_id = ? AND status = 'scheduled'").get(T) as { n: number };
  assert.equal(upcoming.n, 280, "someone has no next visit");
  const soon = db.prepare("SELECT COUNT(*) AS n FROM care_visits WHERE tenant_id = ? AND status = 'scheduled' AND scheduled_at <= ?").get(T, "2026-09-27 23:59:59") as { n: number };
  assert.ok(soon.n > 0, "no visit in the next two days, so W2's visit-prep rule has nothing to show");
  // Every visit is with the person's own care manager.
  const stray = db.prepare(
    `SELECT COUNT(*) AS n FROM care_visits v WHERE v.tenant_id = ? AND NOT EXISTS (
       SELECT 1 FROM caseload_assignments c WHERE c.person_id = v.person_id AND c.clinician_person_id = v.clinician_person_id)`
  ).get(T) as { n: number };
  assert.equal(stray.n, 0);
  const missed = db.prepare("SELECT COUNT(*) AS n FROM care_visits WHERE tenant_id = ? AND status = 'missed'").get(T) as { n: number };
  assert.ok(missed.n > 0, "dropouts have no missed visits");
});

test("synthetic on its face: no PHI, no realistic names, every row inside the tenant", () => {
  for (const f of PHI_FIELDS) {
    const col = f.table === "users" ? "id" : f.table === "safety_plans" ? "user_id" : "person_id";
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${f.table} WHERE ${col} IN (SELECT id FROM users WHERE tenant_id = ?) AND ${f.column} IS NOT NULL AND ${f.column} <> ''`).get(T) as { n: number };
    assert.equal(n.n, 0, `${f.table}.${f.column} was written`);
  }
  const users = db.prepare("SELECT email, name FROM users WHERE tenant_id = ?").all(T) as Array<{ email: string; name: string }>;
  for (const u of users) {
    assert.ok(u.email.endsWith(`@${EVAL_EMAIL_DOMAIN}`), u.email);
    assert.match(u.name, /\(synthetic\)$|^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/, u.name);
  }
  assert.equal(syntheticName(0), "Amber Harbor 001");
  assert.equal(new Set(users.map((u) => u.name)).size, users.length, "two people share a name");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM persons WHERE tenant_id = ? AND provenance <> 'fabricated'").get(T) as { n: number }).n, 0);

  // A row about one of the tenant's people that carries another tenant would
  // show up in that tenant's views.
  for (const table of TENANT_SCOPED_TABLES) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
    const who = ["user_id", "person_id"].find((c) => cols.has(c)) ?? (table === "users" ? "id" : null);
    if (!who || !cols.has("tenant_id")) continue;
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${who} IN (SELECT id FROM users WHERE tenant_id = ?) AND tenant_id <> ?`).get(T, T) as { n: number };
    assert.equal(n.n, 0, `${table} has rows for the tenant's people outside the tenant`);
  }
});

test("a member tester meets the app, not the paywall", async () => {
  const testers = db.prepare("SELECT id FROM users WHERE tenant_id = ? AND email LIKE 'tester%'").all(T) as Array<{ id: string }>;
  assert.equal(testers.length, 3);
  for (const t of testers) {
    assert.equal(await subscriptionActive(t.id), true);
    const cm = db.prepare("SELECT COUNT(*) AS n FROM caseload_assignments WHERE person_id = ? AND ended_at IS NULL").get(t.id) as { n: number };
    assert.equal(cm.n, 1, "a tester is not linked to a care manager");
  }
});

test("the curves: each trajectory's shape, pure", () => {
  assert.equal(curve("engaged_flat", 12), 0.95);
  assert.ok(curve("early_responder", 6) <= 0.5);
  assert.ok(curve("non_responder", 16) > 0.5);
  assert.ok(curve("slow_responder", 16) <= 0.5 && curve("slow_responder", 6) > 0.5);
});

test("the reset removes the tenant's rows and nobody else's", () => {
  const deleted = resetEvaluationTenant(db, T);
  assert.ok(deleted.users >= 290 && deleted.checkins > 1000, JSON.stringify(deleted));
  assert.equal(snapshot().split("\n\n").every((s) => s.endsWith(":")), true, "a tenant row survived the reset");
  assert.deepEqual(outsideCounts(), before, "the reset reached outside the tenant");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?").get(outsider) as { n: number }).n, 1);
  assert.deepEqual(evaluationStatus(T), { seeded: false, staff: 0, patients: 0, historyTo: null });
});

test("the rebuild: seed, identity, events — and the replay agrees with the rows", async () => {
  const r = await rebuildEvaluationTenant(T, ANCHOR);
  assert.equal(r.counts.patients, 280);
  assert.ok(r.eventsInserted > 1000, `${r.eventsInserted} events`);
  // The two single cases, a dropout and an ordinary member: the replay of
  // each person's events rebuilds exactly the rows the seed wrote.
  const sample = [r.counts.roster.find((p) => p.item9)!, r.counts.roster.find((p) => p.crisis)!,
    r.counts.roster.find((p) => p.trajectory === "dropout")!, r.counts.roster[0]];
  for (const p of sample) {
    const v = await verifyProjections({ personId: p.id });
    assert.equal(v.identical, true, JSON.stringify(v.diffs).slice(0, 500));
    assert.ok(v.compared.checkins + v.compared.consents > 0, `nothing compared for ${p.index}`);
  }
  // The identity spine gave every staff member an account in the tenant.
  const accounts = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE person_id IN (SELECT id FROM users WHERE tenant_id = ? AND password_hash <> '!')").get(T) as { n: number };
  assert.equal(accounts.n, 10);
  // A second rebuild removes what the first wrote, events included.
  const again = await rebuildEvaluationTenant(T, ANCHOR);
  assert.ok((again.deleted.longitudinal_events ?? 0) > 0, "the ledger was not cleared");
  assert.equal(again.counts.patients, 280);
});

test("the rebuild refuses anything that is not an evaluation tenant, or holds a real person", async () => {
  await assert.rejects(rebuildEvaluationTenant(PLATFORM_TENANT_ID), EvaluationRefused);
  await assert.rejects(rebuildEvaluationTenant("no-such-tenant"), EvaluationRefused);
  const real = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'Real', 'real')").run(real, T);
  const users = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?").get(T) as { n: number }).n;
  await assert.rejects(rebuildEvaluationTenant(T), /real person/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ?").get(T) as { n: number }).n, users, "a refused rebuild deleted something");
  db.prepare("DELETE FROM persons WHERE id = ?").run(real);
  assert.deepEqual(Object.keys(EVALUATION_PLANS), [T]);
});

test("the controls: a script, an admin button behind the demo admin and a typed reason", () => {
  assert.equal(JSON.parse(read("package.json")).scripts["seed:evolvedmd"], "tsx scripts/seed-evaluation.ts evolvedmd-eval");
  const action = read("src/lib/tenants/evaluation-actions.ts");
  assert.match(action, /^"use server";/);
  assert.match(action, /await requireDemoAdmin\(\)/);
  assert.match(action, /reason\.length < MIN_REASON/);
  assert.match(action, /rebuildEvaluationTenant\(tenantId\)/);
  const page = read("src/app/admin/demo/page.tsx");
  assert.match(page, /<form action=\{rebuildEvaluationTenantAction\}/);
  assert.match(page, /TENANT_CONFIGS\.filter\(\(t\) => t\.mode === "evaluation"\)/);
});
