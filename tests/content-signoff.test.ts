// Unsigned content does not ship (Handoff 10 §0.2, §3.3).
//
//   "isContentLive() returns false unless that row is approved in
//    autonomous_signoffs. In demo mode drafts may render with a 'Pending
//    clinical review' chip; in any other environment they are absent from
//    every list, route, API response, and companion selection. Fail closed."

process.env.EMDR_DATA_DIR = `/tmp/steady-content-signoff-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "content-signoff-secret-at-least-32-chars-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "content-signoff-key";
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import {
  CONTENT_V10_RULES, contentVisibility, isContentLive, isContentRow, visibleContent,
} from "../src/lib/content-signoff";
import { ALL_PRACTICES, listPractices, practiceForMember, type Practice } from "../src/lib/practices";
import { LESSONS, memberLessons, memberLesson, type Lesson } from "../src/lib/lessons";
import { contentWithRows } from "../src/lib/content-registry";
import { SAFETY_CONFIG_VERSION } from "../src/lib/safety/governance";

const db = getDb();
// A row the signed record does NOT approve (Lane E is unsigned), so it starts
// withheld and only a verdict moves it.
const ROW = "CV10_E05";
const SIGNED = "CV10_A03";
const agreed = new Map([[ROW, { verdict: "agree" as const }]]);
const sentBack = new Map([[ROW, { verdict: "needs_change" as const }]]);
const none = new Map();

function member(): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@content.test`);
  return id;
}

function sign(rowId: string, verdict: "agree" | "needs_change") {
  db.prepare("INSERT INTO autonomous_signoffs (id, rule_id, config_version, verdict) VALUES (?, ?, ?, ?)")
    .run(newId(), rowId, SAFETY_CONFIG_VERSION, verdict);
}

// ── The rule, pure ───────────────────────────────────────────────────────────

test("content that predates sign-off is live without a row", () => {
  assert.equal(isContentLive({}, none), true);
});

test("a row must be agreed; unreviewed, sent back, or unknown is not live", () => {
  assert.equal(isContentLive({ signoffRowIds: [ROW] }, agreed), true);
  assert.equal(isContentLive({ signoffRowIds: [ROW] }, none), false);
  assert.equal(isContentLive({ signoffRowIds: [ROW] }, sentBack), false);
  assert.equal(isContentLive({ signoffRowIds: ["CV10_Z99"] }, new Map([["CV10_Z99", { verdict: "agree" as const }]])), false,
    "a verdict on a row that does not exist made content live");
});

test("in demo an unsigned item is a marked draft; anywhere else it is absent", () => {
  assert.equal(contentVisibility({ signoffRowIds: [ROW] }, none, true), "draft");
  assert.equal(contentVisibility({ signoffRowIds: [ROW] }, none, false), "absent");
  assert.equal(contentVisibility({ signoffRowIds: ["CV10_Z99"] }, none, true), "absent", "a mistyped row is not a draft");
  const kept = visibleContent<{ id: string; signoffRowIds?: string[] }>([{ id: "a" }, { id: "b", signoffRowIds: [ROW] }], none, false);
  assert.deepEqual(kept.map((k) => k.id), ["a"]);
});

test("a row the signed record approves is live with no verdict in the table", () => {
  assert.equal(isContentLive({ signoffRowIds: [SIGNED] }, none), true);
});

test("a later needs-change withdraws a signed row", () => {
  assert.equal(isContentLive({ signoffRowIds: [SIGNED] }, new Map([[SIGNED, { verdict: "needs_change" as const }]])), false);
});

test("an item needing several rows is live only when every one is", () => {
  assert.equal(isContentLive({ signoffRowIds: [SIGNED, ROW] }, none), false);
  assert.equal(isContentLive({ signoffRowIds: [] }, none), false, "an empty list must not mean 'needs nothing'");
});

test("row ids follow the worksheet's numbering, and each says what it covers", () => {
  for (const r of CONTENT_V10_RULES) {
    assert.match(r.id, /^CV10_[A-F]\d{2}$/);
    assert.equal(r.category, "content_v10");
    assert.ok(r.reason.length > 40, `${r.id} does not say what a clinician is signing`);
  }
  assert.equal(new Set(CONTENT_V10_RULES.map((r) => r.id)).size, CONTENT_V10_RULES.length);
  // The worksheet's lanes: A 17, B 5, C 5, D 5, E 5, F 5.
  assert.equal(CONTENT_V10_RULES.length, 42);
});

// ── Every list and route ─────────────────────────────────────────────────────

const draftPractice: Practice = {
  id: "fixture-unsigned-skill", type: "skill", title: "Fixture skill", intro: "x", durationSec: 60,
  intensity: 1, tags: [], hasHold: false, steps: [{ text: "Notice your feet." }], signoffRowIds: [ROW],
};
const draftLesson: Lesson = {
  id: "fixture-unsigned-lesson", title: "Fixture lesson", summary: "x", readMinutes: 2, tags: [],
  relatedModuleIds: [], body: "## x", signoffRowIds: [ROW],
};

test("an unsigned practice and lesson are absent from every member read, then appear once agreed", async () => {
  ALL_PRACTICES.push(draftPractice);
  LESSONS.push(draftLesson);
  try {
    const m = member();
    assert.ok(!(await listPractices(m, "skill")).some((p) => p.id === draftPractice.id), "listed while unsigned");
    assert.ok(!(await listPractices(m)).some((p) => p.id === draftPractice.id), "listed while unsigned (all types)");
    assert.deepEqual(await practiceForMember(m, draftPractice.id), { state: "absent" }, "a deep link opened it");
    assert.ok(!(await memberLessons()).some((l) => l.id === draftLesson.id));
    assert.equal(await memberLesson(draftLesson.id), undefined);

    sign(ROW, "agree");
    assert.ok((await listPractices(m, "skill")).some((p) => p.id === draftPractice.id && p.visibility === "live"));
    assert.equal((await practiceForMember(m, draftPractice.id)).state, "open");
    assert.equal((await memberLesson(draftLesson.id))?.visibility, "live");

    sign(ROW, "needs_change");
    assert.ok(!(await listPractices(m, "skill")).some((p) => p.id === draftPractice.id), "sent back, still listed");
  } finally {
    ALL_PRACTICES.splice(ALL_PRACTICES.indexOf(draftPractice), 1);
    LESSONS.splice(LESSONS.indexOf(draftLesson), 1);
  }
});

test("member lesson surfaces read through the sign-off filter", () => {
  const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8");
  assert.doesNotMatch(src("app/app/learn/page.tsx"), /\bLESSONS\b/, "the lesson list reads the raw catalogue");
  assert.doesNotMatch(src("app/app/learn/[lessonId]/page.tsx"), /\bgetLesson\(/, "the lesson page reads the raw catalogue");
  assert.doesNotMatch(src("app/api/mobile/v1/lessons/route.ts"), /\bLESSONS\b/, "the phone reads the raw catalogue");
  assert.doesNotMatch(src("lib/autopilot.ts"), /\bLESSONS\b/, "the daily plan can propose an unsigned lesson");
});

test("every item naming a row names one that exists", () => {
  const bad = contentWithRows().filter((u) => !isContentRow(u.signoffRowId));
  assert.deepEqual(bad, [], "these name sign-off rows that do not exist, so they can never go live");
});

test("a verdict is refused for a row that does not exist", () => {
  const actions = fs.readFileSync(path.join(process.cwd(), "src/lib/actions.ts"), "utf8");
  const body = actions.slice(actions.indexOf("export async function recordRuleSignoff"));
  assert.match(body.slice(0, 2000), /CONTENT_V10_RULES/);
  assert.match(body.slice(0, 2000), /if \(!known\.some\(\(r\) => r\.id === ruleId\)\) redirect\(back\)/);
});
