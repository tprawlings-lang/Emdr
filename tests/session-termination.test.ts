// Sessions end cleanly, once, as their own ratings say they ended (Expansion
// Handoff Phase 0, "session termination logic gaps").
//
//   "Every new tool is a new session type that must terminate cleanly."
//
// Each test here was written to fail against the finish paths as they stood —
// see src/lib/session-close.ts for what each gap was.

process.env.EMDR_DATA_DIR = `/tmp/steady-session-termination-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "session-termination-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "session-termination-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import {
  closeLeftOpen, closeSession, deriveClose, openSessionCutoff, recordPostSessionCheck,
} from "../src/lib/session-close";
import { SESSION_CAP_MIN, SUDS_HARD_STOP_AT } from "../src/lib/session-safety";
import { finishSessionMobile } from "../src/lib/mobile/service";

const db = getDb();
const SRC = path.join(process.cwd(), "src");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const read = (rel: string) => code(fs.readFileSync(path.join(SRC, rel), "utf8"));
const MIN = 60_000;
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function member(): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@termination.test`);
  return id;
}

function opened(userId: string, minutesAgo = 5, moduleId = "calm-place"): string {
  const id = newId();
  db.prepare("INSERT INTO therapy_sessions (id, user_id, module_id, detail_json, started_at) VALUES (?, ?, ?, '{\"focus\":\"the lake\"}', ?)")
    .run(id, userId, moduleId, stamp(Date.now() - minutesAgo * MIN));
  return id;
}

const row = (id: string) =>
  db.prepare("SELECT status, pre_suds, post_suds, peak_suds, hard_stop_reason, detail_json, ended_at, started_at FROM therapy_sessions WHERE id = ?").get(id) as {
    status: string; pre_suds: number | null; post_suds: number | null; peak_suds: number | null;
    hard_stop_reason: string | null; detail_json: string; ended_at: string | null; started_at: string;
  };
const alerts = (userId: string, type: string) =>
  (db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND alert_type = ?").get(userId, type) as { n: number }).n;

// ── The server reads the ending off the ratings ─────────────────────────────

test("a trail that crossed the hard-stop line closes as a hard stop, whatever was claimed", () => {
  const end = deriveClose({ outcome: "completed", sudsTrail: [3, SUDS_HARD_STOP_AT, 4] });
  assert.equal(end.status, "hard_stop");
  assert.equal(end.hardStopReason, `Distress rated ${SUDS_HARD_STOP_AT}/10`);
  assert.deepEqual([end.preSuds, end.postSuds, end.peakSuds], [3, 4, SUDS_HARD_STOP_AT]);
});

test("a request can make an ending more serious, never less", () => {
  assert.equal(deriveClose({ outcome: "hard_stop", hardStopReason: "Ground me, then stopped", sudsTrail: [2, 3] }).status, "hard_stop");
  assert.equal(deriveClose({ outcome: "abandoned", sudsTrail: [2, 3] }).status, "abandoned");
  assert.equal(deriveClose({ outcome: "completed", sudsTrail: [4, 3] }).status, "completed");
});

test("only real ratings are kept — nothing is clamped into one", () => {
  const end = deriveClose({ outcome: "completed", sudsTrail: [2, 14, 2.5, "7", -1, null, 5] });
  assert.deepEqual(end.trail, [2, 5]);
  assert.equal(end.peakSuds, 5);
});

// ── An ended session stays ended ─────────────────────────────────────────────

test("a hard-stopped session cannot be finished again as completed", async () => {
  const m = member();
  const s = opened(m);
  const first = await closeSession(m, s, { outcome: "hard_stop", hardStopReason: "Distress rated 9/10", sudsTrail: [4, 9] }, "web");
  assert.ok(first.ok);
  const second = await closeSession(m, s, { outcome: "completed", sudsTrail: [4, 2] }, "web");
  assert.deepEqual(second, { ok: false, reason: "already_closed" });
  assert.equal(row(s).status, "hard_stop");
  assert.equal(row(s).post_suds, 9, "the record was rewritten to a calmer close");
  assert.equal(alerts(m, "session_hard_stop"), 1);
});

test("the mobile route gets the same answer, and a retry says the first one landed", async () => {
  const m = member();
  const s = opened(m);
  await closeSession(m, s, { outcome: "completed", sudsTrail: [3, 2] }, "web");
  const r = await finishSessionMobile(m, { sessionId: s, outcome: "abandoned", preSuds: 1, postSuds: 1, peakSuds: 1, sudsTrail: [1] });
  assert.deepEqual(r, { ok: false, reason: "already_closed" });
  assert.equal(row(s).status, "completed");
});

test("a close claimed as completed over a crossed trail is recorded as a hard stop, with the claim kept", async () => {
  const m = member();
  const s = opened(m);
  const r = await closeSession(m, s, { outcome: "completed", sudsTrail: [5, 9, 3] }, "mobile");
  assert.ok(r.ok && r.status === "hard_stop");
  const detail = JSON.parse(row(s).detail_json);
  assert.deepEqual(detail.closedAs, { requested: "completed", ratingsSaid: "hard_stop" });
  assert.equal(detail.focus, "the lake", "the focus chosen at start was lost");
  assert.equal(alerts(m, "session_hard_stop"), 1);
});

test("the figures come from the trail, not from beside it", async () => {
  const m = member();
  const s = opened(m);
  await finishSessionMobile(m, { sessionId: s, outcome: "completed", preSuds: 0, postSuds: 0, peakSuds: 0, sudsTrail: [6, 7, 5] });
  const r = row(s);
  assert.deepEqual([r.pre_suds, r.post_suds, r.peak_suds], [6, 5, 7]);
});

test("another member's session cannot be closed", async () => {
  const owner = member();
  const s = opened(owner);
  const r = await closeSession(member(), s, { outcome: "completed", sudsTrail: [] }, "web");
  assert.deepEqual(r, { ok: false, reason: "not_found" });
  assert.equal(row(s).status, "in_progress");
});

// ── Nothing stays open forever ───────────────────────────────────────────────

test("a session left open past the cap is closed as abandoned at the cap, without invented ratings", async () => {
  const m = member();
  const stale = opened(m, 60 * 26);
  const recent = opened(m, 3);
  const now = Date.now();
  assert.equal(await closeLeftOpen(m, now, "web"), 2);
  const a = row(stale);
  assert.equal(a.status, "abandoned");
  const startedMs = new Date(a.started_at.replace(" ", "T") + "Z").getTime();
  assert.equal(a.ended_at, stamp(startedMs + SESSION_CAP_MIN * MIN), "ended at the cap, not whenever it was noticed");
  assert.equal(JSON.parse(a.detail_json).closedFor, "left_open_past_cap");
  assert.equal(a.post_suds, null, "a rating nobody gave was written");
  assert.equal(JSON.parse(row(recent).detail_json).closedFor, "replaced_by_new_session");
  assert.equal(await closeLeftOpen(m, now, "web"), 0, "closing twice closed something twice");
});

test("both start paths close what was left open before opening another", () => {
  const web = read("lib/actions.ts");
  const start = web.slice(web.indexOf("export async function startSession"), web.indexOf("export async function finishSession"));
  const mobile = read("lib/mobile/service.ts");
  const mstart = mobile.slice(mobile.indexOf("export async function startSessionMobile"), mobile.indexOf("export async function finishSessionMobile"));
  for (const [name, body] of [["web", start], ["mobile", mstart]] as const) {
    assert.ok(body.length > 200, `${name}: start function not found`);
    const close = body.indexOf("closeLeftOpen(");
    assert.ok(close > 0, `${name}: starts a session beside one still open`);
    assert.ok(close < body.indexOf("INSERT INTO therapy_sessions"), `${name}: closes after opening`);
  }
});

test("a session past its cap is never offered back", () => {
  const src = read("lib/member/day-read.ts");
  assert.match(src, /status = 'in_progress' AND started_at > \?/);
  assert.match(src, /openSessionCutoff\(/);
  assert.equal(openSessionCutoff(Date.parse("2026-09-24T12:00:00Z")), "2026-09-24 11:15:00");
});

test("one place writes how a session ended", () => {
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /UPDATE therapy_sessions/.test(code(fs.readFileSync(p, "utf8")))) {
        const rel = path.relative(SRC, p);
        if (rel !== "lib/session-close.ts") offenders.push(rel);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], "these end sessions without the one-way close");
});

// ── A hard stop rests processing by itself ───────────────────────────────────

test("the processing rest counts a hard stop by its status, in the gate and the safety core", () => {
  assert.match(read("lib/gating.ts"), /post_suds >= \? OR status = 'hard_stop'/);
  assert.match(read("lib/safety/gather.ts"), /post_suds >= \? OR status = 'hard_stop'/);
});

// ── The check after a session ────────────────────────────────────────────────

const answers = (over: Record<string, unknown> = {}) => ({
  distress: "3", oriented: "yes", safeTonight: "yes", delayedRisk: "2", recoveryConfirmed: true, ...over,
});
const checks = (sessionId: string) =>
  (db.prepare("SELECT COUNT(*) AS n FROM post_session_checks WHERE session_id = ?").get(sessionId) as { n: number }).n;

async function ended(userId: string): Promise<string> {
  const s = opened(userId);
  await closeSession(userId, s, { outcome: "completed", sudsTrail: [4, 3] }, "web");
  return s;
}

test("a missing rating is not zero: nothing is saved", async () => {
  const m = member();
  const s = await ended(m);
  for (const bad of [{ distress: null }, { delayedRisk: "" }, { distress: "11" }, { oriented: undefined }, { safeTonight: "maybe" }]) {
    assert.deepEqual(await recordPostSessionCheck(m, s, answers(bad)), { ok: false, reason: "incomplete" }, JSON.stringify(bad));
  }
  assert.equal(checks(s), 0);
});

test("the check is for the member's own, ended session", async () => {
  const owner = member();
  const s = await ended(owner);
  assert.deepEqual(await recordPostSessionCheck(member(), s, answers()), { ok: false, reason: "not_found" });
  const m = member();
  const open = opened(m);
  assert.deepEqual(await recordPostSessionCheck(m, open, answers()), { ok: false, reason: "still_open" });
  assert.equal(checks(s) + checks(open), 0);
});

test("one check per session, and one alert", async () => {
  const m = member();
  const s = await ended(m);
  const first = await recordPostSessionCheck(m, s, answers({ distress: "9" }));
  assert.deepEqual(first, { ok: true, unsafe: false, escalated: true });
  assert.deepEqual(await recordPostSessionCheck(m, s, answers({ distress: "2" })), { ok: false, reason: "already_checked" });
  assert.equal(checks(s), 1);
  assert.equal(alerts(m, "post_session_review"), 1);
});

test("not safe until tomorrow raises the urgent alert", async () => {
  const m = member();
  const s = await ended(m);
  assert.deepEqual(await recordPostSessionCheck(m, s, answers({ safeTonight: "no" })), { ok: true, unsafe: true, escalated: true });
  assert.equal(alerts(m, "post_session_unsafe"), 1);
});
