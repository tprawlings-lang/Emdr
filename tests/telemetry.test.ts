process.env.EMDR_DATA_DIR = `/tmp/steady-telemetry-${process.pid}-${Date.now()}`;

// Telemetry (handoff 06 §31.7, and §31.3's definition of done).
//
// §31.3 asks for a claim, not a dashboard: "telemetry proves the screen can be
// used without capturing sensitive free text". A logger cannot make that claim
// — it records whatever it is handed — so the nine signals are a CATALOG, each
// field carries a KIND, and a kind is a shape a sentence cannot satisfy.
//
// These guards hold the three properties that claim rests on:
//
//   NOTHING UNDECLARED IS RECORDED. A field the catalog does not name is
//   dropped, and a declared field holding prose is REFUSED rather than
//   truncated into the row. Truncating is worse than refusing: it stores part
//   of a member's sentence and looks like it worked.
//
//   NO SIGNAL CAN NAME A PERSON. Not by field name, and not by column — the
//   table has no person_id. §31.7's strictest row is `permission_denied`:
//   "actor role and policy code; NO SUBJECT IDENTITY", because a denial log
//   naming who was looked at leaks the existence §30.6 step 2 refuses to
//   reveal.
//
//   THE CATALOG TELLS THE TRUTH ABOUT ITSELF. Each signal declares where it is
//   recorded from, and those declarations are checked against the source. A
//   count of zero is only readable if the reader can tell "nobody used it" from
//   "nothing records it", and that distinction is exactly what a stale
//   declaration destroys.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  SIGNALS, SIGNAL_NAMES, OPERATIONAL_REVIEW, FORBIDDEN_FIELD_NAME,
  sanitize, valueAllowed, signal, unanswerable, TelemetryRefused,
} from "../src/lib/telemetry/catalog";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const code = (rel: string) =>
  fs.readFileSync(path.join(SRC, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** Every module under src/ that records a signal, and which signals it names. */
function callSites(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      const rel = path.relative(SRC, p);
      // The store itself defines the recorders; it is not a call site.
      if (rel === "lib/telemetry/store.ts" || rel === "lib/telemetry/catalog.ts") continue;
      const src = code(rel);
      const named = SIGNAL_NAMES.filter((n) => src.includes(`"${n}"`));
      // A surface that renders the catalog names every signal without
      // recording any: the review screen reads them, it does not write them.
      if (named.length > 0 && /noteSignal\(|recordSignal\(|noteSurfaceViewed\(/.test(src)) {
        out.set(rel, named);
      }
    }
  };
  walk(SRC);
  return out;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

test("the nine signals the handoff names are the nine declared", () => {
  // Not "at least nine". A catalog that grew a tenth signal nobody reviewed is
  // the shape a privacy rule gets bypassed in, and one that lost a signal is a
  // measurement question silently abandoned.
  assert.deepEqual(SIGNAL_NAMES, [
    "decision_surface_viewed", "primary_action_selected", "evidence_opened",
    "queue_item_resolved", "gate_support_selected", "chart_range_changed",
    "export_requested", "projection_stale_shown", "permission_denied",
  ]);
});

test("every signal states its purpose and its privacy rule", () => {
  // A signal with no stated limit is a signal whose limit is whatever the
  // caller felt like.
  for (const s of SIGNALS) {
    assert.ok(s.purpose.trim().length > 10, `${s.name} has no purpose`);
    assert.ok(s.privacyRule.trim().length > 5, `${s.name} has no privacy rule`);
    assert.ok(s.fields.length > 0, `${s.name} declares no fields at all`);
  }
});

test("no signal declares a field that could name a person or hold prose", () => {
  // THE RULE THE WHOLE FILE EXISTS FOR, checked against the catalog rather than
  // against a review. A field called `personId` or `noteText` is refused here,
  // where it is one line to fix, instead of in the rows.
  const offenders: string[] = [];
  for (const s of SIGNALS) {
    for (const f of s.fields) {
      if (FORBIDDEN_FIELD_NAME.test(f.name)) offenders.push(`${s.name}.${f.name}`);
    }
  }
  assert.deepEqual(offenders, [], `these fields could name a person or carry text: ${offenders.join(", ")}`);
});

test("the denial signal carries a role and a code and nothing else", () => {
  // §31.7's strictest privacy rule, asserted field by field. Anything more on
  // this row — an account id, a path, a subject — turns a denial counter into a
  // log of who was looked for.
  const denied = signal("permission_denied");
  assert.ok(denied);
  assert.deepEqual(denied.fields.map((f) => f.name).sort(), ["actorRole", "policyCode"]);
  assert.deepEqual(denied.fields.map((f) => f.kind).sort(), ["code", "role"]);
});

test("the telemetry table has no column that could hold a person or their words", () => {
  // A column that cannot hold a person is a stronger guarantee than a rule
  // saying not to fill one in.
  const schema = code("lib/db.ts");
  const m = schema.match(/CREATE TABLE IF NOT EXISTS telemetry_signals \(([\s\S]*?)\n\s*\);/);
  assert.ok(m, "the telemetry_signals table is gone");
  const columns = m[1].split(",").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  assert.ok(columns.includes("signal"), `unexpected columns: ${columns.join(", ")}`);
  const bad = columns.filter((c) => /person|patient|member|subject|user|name|email|text|note|body|content/i.test(c));
  assert.deepEqual(bad, [], `the table can hold: ${bad.join(", ")}`);
});

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

test("a sentence cannot be recorded in a coded field", () => {
  // The claim §31.3 asks for, exercised. Every kind is tried with the thing it
  // is supposed to exclude.
  assert.throws(
    () => sanitize("primary_action_selected", { actionCode: "member said they felt unsafe" }),
    TelemetryRefused
  );
  assert.throws(
    () => sanitize("queue_item_resolved", { reasonCode: "Called them. They are ok." }),
    TelemetryRefused
  );
  assert.throws(
    () => sanitize("queue_item_resolved", { durationMs: "a while" }),
    TelemetryRefused
  );
  assert.throws(
    () => sanitize("chart_range_changed", { metricId: "the one about sleep, I think" }),
    TelemetryRefused
  );
  // And the legitimate values pass.
  assert.deepEqual(
    sanitize("queue_item_resolved", { reasonCode: "checkin_safety_positive", ownerRole: "clinician", durationMs: 1200 }).fields,
    { reasonCode: "checkin_safety_positive", ownerRole: "clinician", durationMs: 1200 }
  );
});

test("an undeclared field is dropped rather than recorded", () => {
  // Dropped, not thrown: a caller passing something extra has not read the
  // catalog, and dropping keeps the row correct. What must never happen is the
  // extra value reaching the row.
  const out = sanitize("primary_action_selected", {
    actionCode: "complete_review",
    personId: "1234",
    note: "he sounded flat",
  });
  assert.deepEqual(out.fields, { actionCode: "complete_review" });
  assert.deepEqual(out.dropped, ["note", "personId"]);
});

test("an undeclared signal is refused outright", () => {
  assert.throws(() => sanitize("member_mood_logged", {}), TelemetryRefused);
});

test("the kinds exclude what they are supposed to exclude", () => {
  assert.ok(valueAllowed("code", "complete_review"));
  assert.ok(!valueAllowed("code", "Complete review"), "a space gets through the code kind");
  assert.ok(!valueAllowed("code", "x".repeat(49)), "the code length cap is gone");
  assert.ok(valueAllowed("ref", "member_today.v4"));
  assert.ok(!valueAllowed("ref", "a sentence with spaces"));
  assert.ok(valueAllowed("duration_ms", 0));
  assert.ok(!valueAllowed("duration_ms", -1), "a negative duration is accepted");
  assert.ok(!valueAllowed("count", 1.5), "a count accepts a fraction");
  assert.ok(!valueAllowed("age_s", "12"), "a numeric kind accepts a string");
});

// ---------------------------------------------------------------------------
// The catalog tells the truth about itself
// ---------------------------------------------------------------------------

test("every declared call site really records that signal", () => {
  // A stale declaration destroys the one thing that makes a zero readable.
  const missing: string[] = [];
  for (const s of SIGNALS) {
    for (const rel of s.recordedFrom) {
      const abs = path.join(SRC, rel);
      if (!fs.existsSync(abs)) { missing.push(`${s.name}: ${rel} does not exist`); continue; }
      const src = code(rel);
      if (!src.includes(`"${s.name}"`) && !/noteSurfaceViewed\(/.test(src)) {
        missing.push(`${s.name}: ${rel} does not record it`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join("\n  "));
});

test("every call site in the codebase is declared in the catalog", () => {
  // The other direction, which is the one that rots. A signal recorded from a
  // module the catalog does not list reads on the screen as "no surface records
  // this yet" while rows arrive.
  const undeclared: string[] = [];
  for (const [rel, named] of callSites()) {
    for (const name of named) {
      const s = signal(name);
      if (!s) continue;
      if (!s.recordedFrom.includes(rel)) undeclared.push(`${name} is recorded from ${rel}, which the catalog does not list`);
    }
  }
  assert.deepEqual(undeclared, [], undeclared.join("\n  "));
});

test("at least one signal has no call site, and the catalog says so plainly", () => {
  // Not an aspiration: chart_range_changed has no surface because no screen in
  // this build has a range control. Guarded so that the day one is added, the
  // declaration is updated with it — and so nobody 'fixes' the zero by
  // inventing a call site.
  const orphan = SIGNALS.filter((s) => s.recordedFrom.length === 0).map((s) => s.name);
  assert.deepEqual(orphan, ["chart_range_changed"], `signals with no call site: ${orphan.join(", ")}`);
});

test("a signal that omits something the handoff names says where it went instead", () => {
  // export_requested does not carry the purpose, because in this product a
  // purpose is a written sentence — and prose is the one thing no signal may
  // hold. An omission with no explanation is indistinguishable from an
  // oversight, so the catalog carries the reason and the screen renders it.
  const exp = signal("export_requested");
  assert.ok(exp);
  assert.ok(!exp.fields.some((f) => /purpose/i.test(f.name)), "the purpose sentence is in the signal");
  assert.ok(exp.deviation && exp.deviation.length > 80, "the omission is unexplained");
  assert.match(exp.deviation, /audit/i, "the deviation does not say where the purpose is recorded");
  // And the export path really does record the purpose where the deviation says.
  const src = code("lib/intelligence/export.ts");
  assert.match(src, /type: "export_created"/);
  assert.match(src, /purpose,/);
});

// ---------------------------------------------------------------------------
// The operational review
// ---------------------------------------------------------------------------

test("the four operational-review questions are each backed by declared signals", () => {
  assert.equal(OPERATIONAL_REVIEW.length, 4);
  for (const q of OPERATIONAL_REVIEW) {
    assert.ok(q.question.endsWith("?"), `${q.question} is not a question`);
    assert.ok(q.answeredBy.length > 0, `${q.question} has nothing behind it`);
    for (const s of q.answeredBy) {
      assert.ok(SIGNAL_NAMES.includes(s), `${q.question} cites ${s}, which is not a signal`);
    }
  }
});

test("a question whose signals have never fired reports as unanswerable", () => {
  // The property the screen depends on: it must be able to say a question
  // cannot be answered here, rather than rendering an empty panel that reads
  // like a clean result.
  const q = OPERATIONAL_REVIEW[2];
  assert.deepEqual(unanswerable(q, new Set()), q.answeredBy);
  assert.deepEqual(unanswerable(q, new Set(SIGNAL_NAMES)), []);
});

test("every signal is cited by at least one question", () => {
  // A signal nothing asks about is data collected for no stated reason, which
  // is the collection §31.7 is written to bound.
  const cited = new Set(OPERATIONAL_REVIEW.flatMap((q) => q.answeredBy));
  const orphans = SIGNAL_NAMES.filter((s) => !cited.has(s));
  assert.deepEqual(orphans, [], `no question asks about: ${orphans.join(", ")}`);
});

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

test("the telemetry screen is reachable and reads the catalog rather than a copy", () => {
  const page = code("app/review/telemetry/page.tsx");
  assert.match(page, /\{SIGNALS\.map\(/, "the screen hard-codes its list instead of reading the catalog");
  assert.match(page, /OPERATIONAL_REVIEW\.map\(/);
  assert.match(page, /unanswerable\(/, "the screen cannot say a question is unanswerable");
  assert.match(page, /requireReviewAccess\(/, "the screen is not behind review access");
  // Registered in both places a review screen has to be, or it exists and
  // nobody can get to it.
  assert.match(code("lib/app/route-register.ts"), /path: "\/review\/telemetry"/);
  assert.match(code("components/clinical/ReviewPage.tsx"), /href: "\/review\/telemetry"/);
});

test("the screen distinguishes the two kinds of zero", () => {
  // A count of zero is only useful next to the reason for it.
  const page = code("app/review/telemetry/page.tsx");
  assert.match(page, /recordedFrom\.length === 0/, "the screen cannot tell an uninstrumented signal from an unused one");
  assert.match(page, /no surface records this yet/);
  assert.match(page, /never fired here/);
});

/** The body of a named function, brace-matched. A guard that greps the whole
 *  file cannot tell which function the `try` it found belongs to — and this
 *  file has four of them. */
function functionBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.ok(start >= 0, `${decl} is gone`);
  // The body opens at the first brace AFTER the parameter list closes. Taking
  // the first brace outright finds the one inside `payload = {}` and returns an
  // empty body that passes nothing — which is how the first version of this
  // helper reported that recordSignal no longer writes the table.
  let parens = 0;
  let open = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") parens += 1;
    else if (src[i] === ")") parens -= 1;
    else if (src[i] === "{" && parens === 0) { open = i; break; }
  }
  assert.ok(open > 0, `${decl} has no body`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${decl} never closes`);
}

test("a telemetry failure never breaks the thing it measures", () => {
  // §31.7's signals measure whether the product works. A product that stops
  // working when its measurement does is worse than an unmeasured one — which
  // is the OPPOSITE of the audit rule in §30.6 step 7, deliberately: an audit
  // row is evidence of a disclosure and fails closed.
  //
  // Checked on the WRITER'S OWN BODY. An earlier version of this guard grepped
  // the file for a `catch`, and there are four of them — so removing the one
  // that matters left it passing while a failed insert would have taken down a
  // member's Today screen.
  const store = code("lib/telemetry/store.ts");
  const body = functionBody(store, "export async function recordSignal");
  const insert = body.indexOf("INSERT INTO telemetry_signals");
  const tryAt = body.indexOf("try {");
  assert.ok(insert > 0, "recordSignal no longer writes the table");
  assert.ok(tryAt >= 0 && tryAt < insert, "the insert is not inside a try");
  assert.match(body.slice(insert), /catch/, "nothing catches a failed insert");

  // The refusal is deliberately NOT swallowed: a caller passing prose has a
  // defect, and hiding it would make the catalog decorative.
  assert.ok(
    body.indexOf("sanitize(") < tryAt,
    "the catalog check moved inside the try, so a refusal is now silent"
  );

  // And the render-path helper cannot reject into a page.
  const note = functionBody(store, "export function noteSignal");
  assert.match(note, /\.catch\(/, "noteSignal can reject into a render");
});
