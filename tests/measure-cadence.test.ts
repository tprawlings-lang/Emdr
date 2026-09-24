// A questionnaire is never given again before the stretch of time it asks
// about has passed (Expansion Handoff Phase 0, "screener retake bypass"; §4).
//
// Written to fail against the code as it stood: the seven-day wait lived only
// in whether the "Begin" link rendered. The questionnaire page, the web action
// and the mobile route saved any instrument at any time, and the weekly trauma
// measures asked about "the past month" every seven days.

process.env.EMDR_DATA_DIR = `/tmp/steady-measure-cadence-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "measure-cadence-secret-at-least-32-chars-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "measure-cadence-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { INSTRUMENTS, getInstrument, type Instrument } from "../src/lib/instruments";
import {
  MeasureNotOpen, TRACKED_MEASURES, WEEKLY_WORDING_APPROVAL, measureWindow, saveMeasureResponse, trackedForm,
  weeklyWordingApproved,
} from "../src/lib/measures/cadence";
import { measuresInfo, submitMeasureMobile } from "../src/lib/mobile/onboarding";

const db = getDb();
const SRC = path.join(process.cwd(), "src");
const DAY = 86_400_000;
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function member(): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@cadence.test`);
  return id;
}

function takenAgo(userId: string, form: Instrument, days: number, total = 20): void {
  db.prepare(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json, created_at)
     VALUES (?, ?, ?, ?, ?, '[]', '[]', ?)`
  ).run(newId(), userId, form.id, form.version, total, new Date(Date.now() - days * DAY).toISOString().slice(0, 19).replace("T", " "));
}

const zeros = (f: Instrument) => f.items.map(() => 0);
const save = (userId: string, form: Instrument) =>
  saveMeasureResponse({ userId, form, answers: zeros(form), total: 0, riskFlags: [], nowMs: Date.now() });

/** Every word an instrument puts in front of a member. */
const instructions = (f: Instrument) => [f.intro, ...(f.sections ?? []).map((s) => s.heading)].join(" ");
const PHRASE_DAYS: Array<[RegExp, number]> = [[/past month/i, 30], [/last 2 weeks/i, 14], [/past week/i, 7]];

test("each window is read off the instrument's own words, not chosen", () => {
  const forms = [...INSTRUMENTS, ...TRACKED_MEASURES.flatMap((t) => (t.pastWeek ? [t.pastWeek] : []))];
  for (const f of forms) {
    assert.ok(instructions(f).includes(f.recallPhrase), `${f.id} (${f.version}): "${f.recallPhrase}" is not in what the member reads`);
    const rule = PHRASE_DAYS.find(([rx]) => rx.test(f.recallPhrase));
    assert.ok(rule, `${f.id}: no known period in "${f.recallPhrase}"`);
    assert.equal(f.recallDays, rule[1], `${f.id}: "${f.recallPhrase}" is ${rule[1]} days, not ${f.recallDays}`);
  }
});

test("the past-week form asks about the past week, and only the past week", () => {
  const week = TRACKED_MEASURES.find((t) => t.id === "pcl-5")!.pastWeek!;
  assert.match(week.intro, /In the past week/);
  assert.doesNotMatch(instructions(week), /past month/i);
  assert.deepEqual(week.items, getInstrument("pcl-5")!.items, "the questions themselves must not change");
  assert.notEqual(week.version, getInstrument("pcl-5")!.version, "a past-week score must be distinguishable in the record");
});

test("the past-week wording is not given until it is signed, and is once it is", () => {
  assert.equal(weeklyWordingApproved(), false, "the wording approval was flipped — that needs its own reviewed change");
  assert.equal(WEEKLY_WORDING_APPROVAL.covers.length > 0, true);
  assert.equal(trackedForm("pcl-5")!.recallDays, 30, "unsigned: the approved past-month wording, on its own window");
  const signed = { approvedBy: "A. Reviewer, PsyD", approvedAt: "2026-10-01", covers: [] };
  assert.equal(trackedForm("pcl-5", signed)!.recallDays, 7);
  assert.equal(trackedForm("itq", signed)!.recallDays, 30, "the ITQ has no past-week form; signing the PCL-5 wording must not shorten it");
  assert.equal(trackedForm("phq-9"), undefined, "only the tracked measures are repeated between visits");
});

test("inside its window a questionnaire is refused and nothing is saved", async () => {
  const m = member();
  const phq = getInstrument("phq-9")!;
  takenAgo(m, phq, 13);
  await assert.rejects(save(m, phq), MeasureNotOpen);
  const n = db.prepare("SELECT COUNT(*) AS n FROM screenings WHERE user_id = ?").get(m) as { n: number };
  assert.equal(n.n, 1, "a refused answer was written anyway");
  const w = await measureWindow(m, phq, Date.now());
  assert.equal(w.daysUntilOpen, 1);
});

test("once the window has passed it opens", async () => {
  const m = member();
  const phq = getInstrument("phq-9")!;
  takenAgo(m, phq, 14);
  await save(m, phq);
});

test("the window counts an answer given on any path, in any wording", async () => {
  // A baseline PCL-5 last week holds the repeated one: the member's memory of
  // the past month does not know which screen asked.
  const m = member();
  takenAgo(m, getInstrument("pcl-5")!, 7);
  await assert.rejects(save(m, trackedForm("pcl-5")!), MeasureNotOpen);
  const week = TRACKED_MEASURES.find((t) => t.id === "pcl-5")!.pastWeek!;
  const m2 = member();
  takenAgo(m2, week, 3);
  await assert.rejects(save(m2, getInstrument("pcl-5")!), MeasureNotOpen, "a past-month answer three days after a past-week one");
});

test("the rise check compares like with like", async () => {
  const m = member();
  const month = getInstrument("pcl-5")!;
  const week = TRACKED_MEASURES.find((t) => t.id === "pcl-5")!.pastWeek!;
  // The past-month answer is the MORE RECENT one, so a comparison that ignores
  // the wording would pick it.
  takenAgo(m, week, 40, 12);
  takenAgo(m, month, 31, 50);
  const { previousTotal } = await save(m, week);
  assert.equal(previousTotal, 12, "compared a past-week score against a past-month one");
});

test("the mobile route is held to the same window", async () => {
  const m = member();
  const gad = getInstrument("gad-7")!;
  takenAgo(m, gad, 2);
  const r = await submitMeasureMobile(m, "gad-7", zeros(gad));
  assert.ok("error" in r, "the mobile route saved a questionnaire two days into a fourteen-day window");
});

test("the mobile questionnaire list carries no clinical name, cutoff or risk item", async () => {
  const { instruments } = await measuresInfo(member());
  for (const i of instruments) {
    const keys = Object.keys(i);
    for (const k of ["cutoff", "cutoffNote", "riskItems", "memberTitle"]) assert.ok(!keys.includes(k), `${i.id} sends ${k}`);
    assert.equal(i.title, getInstrument(i.id)!.memberTitle);
  }
});

test("only the one writer saves questionnaire answers", () => {
  // Seeders write fabricated history on purpose; the program-fit questions
  // have their own writer with their own refusal.
  const ALLOWED = new Set([
    "lib/measures/cadence.ts", "lib/fitness-screener.ts",
    "lib/demo-seed.ts", "lib/demo-population-generator.ts", "lib/agents/runner.ts", "lib/demo/new-patient-store.ts",
  ]);
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /INSERT INTO screenings/.test(code(fs.readFileSync(p, "utf8")))) {
        const rel = path.relative(SRC, p);
        if (!ALLOWED.has(rel)) offenders.push(rel);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], "these save answers without the window check — use saveMeasureResponse");
});

test("the questionnaire page checks the window itself, not just the link to it", () => {
  const page = code(fs.readFileSync(path.join(SRC, "app/app/measures/[instrumentId]/page.tsx"), "utf8"));
  assert.match(page, /measureWindow\(/);
  const list = code(fs.readFileSync(path.join(SRC, "app/app/measures/page.tsx"), "utf8"));
  assert.match(list, /measureWindow\(/, "the list would offer what the save refuses");
  assert.doesNotMatch(list, /cadenceDays/, "a second copy of the schedule");
});
