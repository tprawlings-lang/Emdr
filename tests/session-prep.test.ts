// Session Prep (§11, Phase 4).
//
// Phase 4's definition of done is three lines:
//
//   Open follow-ups and active threads appear.
//   Steady Noticed is visually distinct.
//   Uncited generated claims are withheld.
//
// The third is the one that matters most and the one a passing screen can hide:
// a brief that quietly drops a claim looks identical to a brief that never had
// it. So the drops are reported, and this checks the report.

process.env.EMDR_DATA_DIR = `/tmp/steady-prep-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "prep-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "prep-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { demoId } from "../src/lib/demo-seed";
import {
  assemble, validateClaims, buildSessionPrep, prepCacheKey,
  SESSION_PREP_VERSION, SECTION_TITLE,
  type PrepClaim, type PrepInputs,
} from "../src/lib/clinical/session-prep";
import { getTask } from "../src/lib/ai-gateway/registry";
import type { TenantContext } from "../src/lib/repository";
import type { MemoryItem } from "../src/lib/clinical/memory-store";

getDb();
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: demoId(2) };
const MEMBER = demoId(0);
const NOW = new Date("2026-09-04T10:00:00.000Z");

function claim(over: Partial<PrepClaim> = {}): PrepClaim {
  return {
    section: "last_session", text: "A claim.", citations: ["ev1"],
    origin: "deterministic", ...over,
  };
}

// ---------------------------------------------------------------------------
// Uncited claims are withheld
// ---------------------------------------------------------------------------

test("a claim with no citation is dropped and the drop is reported", () => {
  const { kept, omitted } = validateClaims([claim({ citations: [] })], new Set(["ev1"]));
  assert.equal(kept.length, 0);
  assert.equal(omitted.length, 1, "a silent drop is indistinguishable from a claim that never existed");
  assert.match(omitted[0].reason, /cannot cite/);
});

test("a claim citing outside the authorized evidence is dropped", () => {
  const { kept, omitted } = validateClaims(
    [claim({ citations: ["ev1", "somewhere-else"] })],
    new Set(["ev1"])
  );
  assert.equal(kept.length, 0, "one unresolvable citation invalidates the claim — not most of it");
  assert.match(omitted[0].reason, /outside the authorized evidence/);
});

test("a machine-derived claim with no explanation is dropped", () => {
  // §11: "every item gets a Why am I seeing this? action that opens evidence."
  // A machine line with no explanation is what the section exists to not be.
  const { kept, omitted } = validateClaims(
    [claim({ section: "steady_noticed", origin: "generated", why: undefined })],
    new Set(["ev1"])
  );
  assert.equal(kept.length, 0);
  assert.match(omitted[0].reason, /no explanation/);
});

test("a fully cited claim survives", () => {
  const { kept, omitted } = validateClaims([claim()], new Set(["ev1"]));
  assert.equal(kept.length, 1);
  assert.equal(omitted.length, 0);
});

test("the validator is given the evidence set, not a way to look it up", () => {
  // A caller cannot widen the evidence by passing a different loader, because
  // there is no loader to pass.
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/clinical/session-prep.ts"), "utf8");
  const fn = src.slice(src.indexOf("export function validateClaims"), src.indexOf("// ------", src.indexOf("export function validateClaims")));
  assert.ok(!/await |async /.test(fn), "validation must not be able to read anything");
});

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

function inputs(over: Partial<PrepInputs> = {}): PrepInputs {
  return {
    timeline: {
      personId: MEMBER, entries: [], laneCounts: {}, reconstructedCount: 0,
      withheld: { count: 0, reason: "" }, policyVersion: "p", asOf: null,
    },
    memory: [], followUps: [], threads: [], threadEntries: [], goals: [], notes: [], now: NOW,
    ...over,
  };
}

function memItem(over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "m1", personId: MEMBER, sourceThoughtId: "t1", sourceTranscriptId: "tr1",
    itemType: "symptom", statementClass: "clinician_observation",
    normalizedLabel: "sleep", displayText: "Sleep is poor.", status: "approved",
    approvedBy: demoId(2), approvedAt: "2026-06-01T09:00:00.000Z", supersedesId: null,
    span: null, numericFacts: [], createdAt: "2026-06-01T09:00:00.000Z", ...over,
  };
}

test("follow-ups appear under You wanted to revisit, as the clinician's own", () => {
  const claims = assemble(inputs({
    followUps: [{
      itemId: "f1", personId: MEMBER, text: "Follow up on sleep.", label: "sleep",
      approvedBy: demoId(2), approvedAt: "2026-08-01T09:00:00.000Z", sourceThoughtId: "t1",
    }],
  }));
  const revisit = claims.filter((c) => c.section === "revisit");
  assert.equal(revisit.length, 1, "Phase 4: open follow-ups must appear");
  assert.equal(revisit[0].text, "Follow up on sleep.");
  assert.deepEqual(revisit[0].citations, ["f1"]);
  assert.equal(revisit[0].origin, "deterministic", "a follow-up is a record, not a synthesis");
});

test("active threads appear, and say when nothing under them was observed", () => {
  const hypothesis = memItem({ id: "h1", statementClass: "clinician_hypothesis", displayText: "Might connect to her sister." });
  const claims = assemble(inputs({
    threadEntries: [{
      thread: {
        id: "th1", personId: MEMBER, threadType: "theme", canonicalLabel: "her sister",
        status: "active", createdBy: "clinician", firstSeenAt: null,
        lastSeenAt: "2026-06-01T09:00:00.000Z", createdAt: "2026-06-01T09:00:00.000Z",
      },
      entries: [{ membership: {} as never, item: hypothesis }],
    }],
  }));
  const threads = claims.filter((c) => c.section === "active_threads");
  assert.equal(threads.length, 1, "Phase 4: active threads must appear");
  assert.match(threads[0].text, /none recorded as observed/,
    "a theme built only of thinking-aloud must say so in the brief, not only on the themes page");
  // §9's no-fact-promotion: the class travels so the renderer shows it as one.
  assert.equal(threads[0].statementClass, "clinician_hypothesis");
});

test("an empty thread contributes nothing", () => {
  const claims = assemble(inputs({
    threadEntries: [{
      thread: {
        id: "th2", personId: MEMBER, threadType: "theme", canonicalLabel: "empty",
        status: "active", createdBy: "clinician", firstSeenAt: null, lastSeenAt: null, createdAt: "",
      },
      entries: [],
    }],
  }));
  assert.equal(claims.filter((c) => c.section === "active_threads").length, 0,
    "a name with no evidence under it is not a thread worth a clinician's minute");
});

test("between-visit events are grouped, not listed one by one", () => {
  const entries = Array.from({ length: 9 }, (_, i) => ({
    eventId: `e${i}`, lane: "member" as never, type: "daily_checkin.completed",
    occurredAt: `2026-08-${String(10 + i).padStart(2, "0")}T09:00:00.000Z`,
    recordedAt: "", actorType: "patient", actorId: null,
    headline: `Check-in ${i}`, detail: {}, reconstructed: false, aiProduced: false, correlationId: null,
  }));
  const claims = assemble(inputs({
    timeline: { ...inputs().timeline, entries },
  }));
  const bv = claims.filter((c) => c.section === "between_visit");
  assert.equal(bv.length, 1, "nine lines is a log; a brief needs the shape");
  assert.match(bv[0].text, /^9 /);
  assert.ok(bv[0].citations.length > 1, "and it still cites what it summarised");
});

// ---------------------------------------------------------------------------
// Steady Noticed
// ---------------------------------------------------------------------------

test("every Steady Noticed item carries a why and is marked generated", () => {
  const followUp = {
    itemId: "f1", personId: MEMBER, text: "Follow up on sleep.", label: "sleep",
    approvedBy: demoId(2), approvedAt: "2026-07-01T09:00:00.000Z", sourceThoughtId: "t1",
  };
  const later = memItem({ id: "m2", normalizedLabel: "sleep", createdAt: "2026-08-15T09:00:00.000Z" });
  const claims = assemble(inputs({ followUps: [followUp], memory: [later] }));
  const noticed = claims.filter((c) => c.section === "steady_noticed");
  assert.ok(noticed.length >= 1, "the cross-reference should fire");
  for (const n of noticed) {
    assert.equal(n.origin, "generated",
      "the section is machine-created; labelling it otherwise because no model ran would hide that from the reader");
    assert.ok(n.why && n.why.length > 0, "§11 requires a Why am I seeing this on every item");
    assert.ok(n.citations.length > 0);
  }
});

test("a stale hypothesis is noticed, and a fresh one is not", () => {
  const stale = memItem({
    id: "h-old", statementClass: "clinician_hypothesis", normalizedLabel: "abandonment",
    createdAt: "2026-01-01T09:00:00.000Z",
  });
  const fresh = memItem({
    id: "h-new", statementClass: "clinician_hypothesis", normalizedLabel: "work",
    createdAt: "2026-08-28T09:00:00.000Z",
  });
  const noticed = assemble(inputs({ memory: [stale, fresh] }))
    .filter((c) => c.section === "steady_noticed");
  const cited = noticed.flatMap((n) => n.citations);
  // An untested hypothesis hardening into a working assumption is the failure
  // the statement classes exist to prevent, and time is how it happens.
  assert.ok(cited.includes("h-old"));
  assert.ok(!cited.includes("h-new"), "a recent hypothesis is not yet a problem");
});

test("a hypothesis that later evidence speaks to is not flagged as untested", () => {
  const h = memItem({
    id: "h1", statementClass: "clinician_hypothesis", normalizedLabel: "sleep",
    createdAt: "2026-01-01T09:00:00.000Z",
  });
  const later = memItem({ id: "m9", normalizedLabel: "sleep", createdAt: "2026-08-01T09:00:00.000Z" });
  const noticed = assemble(inputs({ memory: [h, later] })).filter((c) => c.section === "steady_noticed");
  const untested = noticed.filter((n) => n.text.includes("nothing added to it since"));
  assert.equal(untested.length, 0);
});

// ---------------------------------------------------------------------------
// Provenance and caching
// ---------------------------------------------------------------------------

test("the cache key includes everything that can change the brief", () => {
  const base = {
    personId: MEMBER, tenantId: PLATFORM_TENANT_ID,
    evidenceCutoff: "2026-09-04T10:00:00.000Z", clinicalPolicyVersion: "policy-a",
  };
  const a = prepCacheKey(base);
  // §11 names person, tenant, evidence cutoff, retrieval/prompt version and
  // policy versions. A key missing any of them serves a brief composed under
  // rules that no longer apply, and nothing about the stale answer looks stale.
  assert.notEqual(a, prepCacheKey({ ...base, personId: "someone-else" }));
  assert.notEqual(a, prepCacheKey({ ...base, tenantId: "other-tenant" }));
  assert.notEqual(a, prepCacheKey({ ...base, evidenceCutoff: "2026-09-05T10:00:00.000Z" }));
  assert.notEqual(a, prepCacheKey({ ...base, clinicalPolicyVersion: "policy-b" }));
  assert.equal(a, prepCacheKey(base), "and it is stable for the same inputs");
});

test("the brief is built over the seeded demo record", async () => {
  const prep = await buildSessionPrep(ctx, MEMBER, { now: NOW });
  assert.equal(prep.personId, MEMBER);
  assert.ok(prep.provenance.authorizedEvidence > 0, "a brief with no authorized evidence can make no claim");
  assert.equal(prep.provenance.prepVersion, SESSION_PREP_VERSION);
  // Phase 4's first line of done, over real data.
  assert.ok(prep.sections.revisit.length >= 1, "the seeded follow-up must appear");
  assert.ok(prep.sections.active_threads.length >= 1, "the seeded theme must appear");
  // Every surviving claim cites something the brief was allowed to read.
  for (const list of Object.values(prep.sections)) {
    for (const c of list) assert.ok(c.citations.length > 0);
  }
});

test("the brief names what it did not look at", async () => {
  const prep = await buildSessionPrep(ctx, MEMBER, { now: NOW });
  assert.ok(prep.provenance.excluded.length > 0,
    "stated rather than implied — a brief that lists only what it saw reads as complete");
  assert.ok(prep.provenance.excluded.some((e) => /kept|accepted/i.test(e)));
});

test("the compose task is optional and falls back to the deterministic brief", () => {
  const task = getTask("clinician.session_prep.compose");
  assert.ok(task, "§9 registers this task");
  assert.equal(task.fallback, "deterministic",
    "the brief must be complete without a model; generation is for wording, not for the noticing");
});

test("all five of §11's sections have a title", () => {
  for (const s of ["last_session", "revisit", "between_visit", "active_threads", "steady_noticed"] as const) {
    assert.ok(SECTION_TITLE[s]?.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Steady Noticed is visually distinct (Phase 4's second line of done)
// ---------------------------------------------------------------------------

test("Steady Noticed renders in its own frame, not as another section", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/SessionPrepPanel.tsx"), "utf8") as string;

  // The four deterministic sections share one loop; Steady Noticed does not,
  // because rendering it through the same path is how it comes to look the
  // same. A badge in the corner is not distinct — the ground is.
  assert.ok(/DETERMINISTIC_ORDER/.test(panel), "the record sections share one renderer");
  // The array literal spans lines, so the check has to as well. The first
  // version used [^\n]* and a mutation that added "steady_noticed" on the next
  // line sailed through it — a guard that only reads one line of a multi-line
  // declaration is checking the formatting, not the content.
  const decl = panel.slice(
    panel.indexOf("const DETERMINISTIC_ORDER"),
    panel.indexOf("];", panel.indexOf("const DETERMINISTIC_ORDER"))
  );
  assert.ok(decl.length > 20, "the declaration must actually have been found");
  assert.ok(!decl.includes("steady_noticed"),
    "Steady Noticed must not be rendered through the same loop as the records");
  assert.ok(/bg-amber-50/.test(panel), "it needs its own ground, not only its own heading");

  // And it says what it is, in words.
  assert.ok(/none of it was written by a person/.test(panel),
    "§11: Steady Noticed is explicitly machine-created, and explicitly means in words");
});

test("every machine-derived item shows its Why am I seeing this inline", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/SessionPrepPanel.tsx"), "utf8") as string;
  assert.ok(/Why am I seeing this\?/.test(panel));
  // Inline, not behind a hover: a tooltip is not an action on a phone, on a
  // keyboard, or on paper.
  assert.ok(!/title=\{[^}]*why/i.test(panel), "the explanation must not be a tooltip");
});

test("a hypothesis is labelled as one wherever the brief shows it", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/SessionPrepPanel.tsx"), "utf8") as string;
  assert.ok(/CLASS_NOTE/.test(panel));
  assert.ok(/recorded as a hypothesis/.test(panel),
    "§9's no-fact-promotion has to survive the last hop, which is the hop where it is usually lost");
  // Read from the claim rather than from the sentence having been worded well.
  assert.ok(/c\.statementClass/.test(panel));
});

test("empty sections do not consume a line of the minute", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/SessionPrepPanel.tsx"), "utf8") as string;
  assert.ok(/filter\(\(s\) => prep\.sections\[s\]\.length > 0\)/.test(panel),
    "§11 caps the brief at about a minute; an empty heading costs attention and returns nothing");
});

// ---------------------------------------------------------------------------
// The clinician's own note
// ---------------------------------------------------------------------------

test("the newest saved note is quoted in Last session", () => {
  const claims = assemble(inputs({
    notes: [
      { thoughtId: "th-new", text: "She stayed with it today.", recordedAt: "2026-09-03T10:00:00.000Z", typed: true },
      { thoughtId: "th-old", text: "Older note.", recordedAt: "2026-08-01T10:00:00.000Z", typed: false },
    ],
  }));
  const last = claims.filter((c) => c.section === "last_session");
  const note = last.find((c) => c.text.startsWith("Your note"));
  assert.ok(note, "the most useful thing in a pre-session brief is what you thought last time");
  assert.match(note.text, /She stayed with it today/);
  assert.deepEqual(note.citations, ["th-new"], "cited to the thought, so the brief can open it");
  // One note, not a list: §11 caps the brief at about a minute and every note
  // ever written is a record rather than a brief.
  assert.equal(last.filter((c) => c.text.startsWith("Your note")).length, 1);
});

test("a long note is trimmed rather than dropped", () => {
  const long = "x".repeat(900);
  const claims = assemble(inputs({
    notes: [{ thoughtId: "th1", text: long, recordedAt: "2026-09-03T10:00:00.000Z", typed: true }],
  }));
  const note = claims.find((c) => c.text.startsWith("Your note"))!;
  assert.ok(note.text.length < 500, "a brief that pastes a whole note is not a brief");
  assert.match(note.text, /…/, "and it says it was trimmed rather than ending mid-word silently");
});

test("a note is quoted, never paraphrased", () => {
  const claims = assemble(inputs({
    notes: [{ thoughtId: "th1", text: "Not reading that as avoidance yet.", recordedAt: NOW.toISOString(), typed: true }],
  }));
  const note = claims.find((c) => c.text.startsWith("Your note"))!;
  // This is the one place in the brief where paraphrasing would lose the thing
  // that makes it worth reading — and where a hedge could quietly harden.
  assert.match(note.text, /“Not reading that as avoidance yet\.”/);
});

test("only saved thoughts reach the brief", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/clinical/session-prep.ts", "utf8");
  assert.match(src, /filter\(\(t\) => t\.status === "saved"\)/,
    "a thought still in review is a draft of a judgement; showing it back would present unfinished thinking as settled");
});
