process.env.EMDR_DATA_DIR = `/tmp/steady-referral-${process.pid}-${Date.now()}`;

// The referral packet (handoff 09 §11's referral-export decision).
//
// §11 asked whether a referral export is assembled by the system or curated by
// the member, and the answer was PASSIVE COMPILATION with a condition: the
// system "tells the member what it contains". Compiling somebody's record
// without asking them is only defensible if they can read the result first.
//
// A REFERRAL PACKET IS THE ONE ARTEFACT IN THIS PRODUCT THAT LEAVES IT, so the
// guards here are about the two limits rather than about the fields:
//
//   NO PROSE, ENFORCED BY SHAPE. Every value is a code, a count, a score, a
//   date or a short label. Not because free text is untidy — because the things
//   a member wrote are the things they wrote to Steady, and a companion message
//   in a disclosure is the one place somebody was candid because it was not
//   going anywhere.
//
//   NOTHING IS DISCLOSABLE, and that is a fact about consent rather than about
//   plumbing. Three scopes exist and none of them authorises sending a record
//   outside this product, so the packet can be compiled and shown to the member
//   whose record it is, and to nobody else.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  NEVER_INCLUDED, EXISTING_SCOPES, DISCLOSURE_SCOPE, PacketRefused,
  assertShape, shapeAllowed, mayDisclose, refusalText, compile,
  type PacketSection,
} from "../src/lib/clinical/referral-packet";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const code = (rel: string) =>
  fs.readFileSync(path.join(SRC, rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

const section = (over: Partial<PacketSection> = {}): PacketSection => ({
  kind: "measures",
  title: "Latest validated measures",
  why: "The scores a receiving clinician would otherwise re-collect.",
  fields: [{ label: "phq-9 (standard)", shape: "score", value: "12", source: "Your most recent phq-9." }],
  absent: null,
  ...over,
});

// ---------------------------------------------------------------------------
// No prose leaves
// ---------------------------------------------------------------------------

test("a sentence cannot be put in a packet field", () => {
  // The rule the whole file exists for, exercised against each shape with the
  // thing it is supposed to exclude.
  assert.throws(() => assertShape({
    label: "Routing", shape: "code",
    value: "member said they felt unsafe walking home", source: "x",
  }), PacketRefused);
  assert.throws(() => assertShape({
    label: "Sessions", shape: "count", value: "several", source: "x",
  }), PacketRefused);
  assert.throws(() => assertShape({
    label: "Granted", shape: "date", value: "last spring", source: "x",
  }), PacketRefused);
  assert.throws(() => assertShape({
    label: "Note", shape: "label",
    value: "She is doing better. Her sleep improved after the second week.", source: "x",
  }), PacketRefused);
  // And the legitimate values pass.
  assert.ok(shapeAllowed("code", "grounding_only"));
  assert.ok(shapeAllowed("count", "14"));
  assert.ok(shapeAllowed("score", "12"));
  assert.ok(shapeAllowed("score", "12/27"));
  assert.ok(shapeAllowed("date", "2026-09-10"));
  assert.ok(shapeAllowed("label", "Recommended track"));
});

test("the shapes exclude what they are supposed to exclude", () => {
  assert.ok(!shapeAllowed("code", "Grounding Only"), "a code accepts spaces and capitals");
  assert.ok(!shapeAllowed("code", "x".repeat(49)), "the code length cap is gone");
  assert.ok(!shapeAllowed("count", "-1"), "a count accepts a negative");
  assert.ok(!shapeAllowed("count", "12.5"), "a count accepts a fraction");
  assert.ok(!shapeAllowed("date", "2026-09-10T09:00:00Z"), "a date carries a time of day");
  assert.ok(!shapeAllowed("label", "x".repeat(200)), "a label has no length cap");
});

test("a packet refuses to assemble if any field is the wrong shape", () => {
  // Refused at assembly rather than trimmed. A truncated sentence in a
  // disclosure is still a sentence that left, and it looks like it worked.
  assert.throws(
    () => compile({
      personId: "p1",
      compiledAt: "2026-09-10T00:00:00Z",
      scopes: [],
      sections: [section({
        fields: [{ label: "Note", shape: "code", value: "called them, doing better", source: "x" }],
      })],
    }),
    PacketRefused
  );
});

test("a section must say why it is in a disclosure, and an empty one must say why it is empty", () => {
  // A section that cannot say why it is in a disclosure does not belong in one.
  assert.throws(
    () => compile({
      personId: "p1", compiledAt: "2026-09-10T00:00:00Z", scopes: [],
      sections: [section({ why: "  " })],
    }),
    PacketRefused
  );
  // And an empty section that says nothing reads as "this person has none of
  // this", which is a claim rather than an absence.
  assert.throws(
    () => compile({
      personId: "p1", compiledAt: "2026-09-10T00:00:00Z", scopes: [],
      sections: [section({ fields: [], absent: null })],
    }),
    PacketRefused
  );
  const ok = compile({
    personId: "p1", compiledAt: "2026-09-10T00:00:00Z", scopes: [],
    sections: [section({ fields: [], absent: "No validated measure has been completed yet." })],
  });
  assert.equal(ok.sections[0].fields.length, 0);
});

test("the exclusions are named and each one says why", () => {
  // "We do not send your conversations" is reassuring. A list with reasons is
  // checkable, which is the difference this page turns on.
  assert.ok(NEVER_INCLUDED.length >= 4);
  for (const e of NEVER_INCLUDED) {
    assert.ok(e.what.trim().length > 5, "an exclusion with no name");
    assert.ok(e.why.trim().length > 60, `${e.what} does not say why`);
  }
  const joined = NEVER_INCLUDED.map((e) => `${e.what} ${e.why}`).join(" ").toLowerCase();
  for (const must of ["companion", "session", "note", "free text"]) {
    assert.ok(joined.includes(must), `the exclusions never mention ${must}`);
  }
});

// ---------------------------------------------------------------------------
// Nothing is disclosable
// ---------------------------------------------------------------------------

test("no packet may be disclosed, and the refusal names the missing consent", () => {
  // THE FACT THIS RESTS ON. Three scopes exist and none of them is a consent to
  // disclose, so a packet compiled from a member's whole history still cannot
  // go anywhere.
  const packet = compile({
    personId: "p1", compiledAt: "2026-09-10T00:00:00Z",
    scopes: EXISTING_SCOPES.map((s) => s.scope),
    sections: [section()],
  });
  assert.equal(packet.disclosable, false, "a packet became disclosable on the existing scopes");
  assert.ok(packet.refusal, "a packet that cannot be sent does not say so");
  assert.match(packet.refusal, new RegExp(DISCLOSURE_SCOPE));
  assert.match(packet.refusal, /no destination/i, "the refusal names only one of the two absences");
});

test("the disclosure scope does not exist among the scopes that do", () => {
  // If this ever fails, somebody has added a disclosure consent — which is a
  // decision with a review attached, not a schema change.
  const existing = EXISTING_SCOPES.map((s) => s.scope);
  assert.ok(!existing.includes(DISCLOSURE_SCOPE), "a disclosure consent scope now exists");
  for (const s of EXISTING_SCOPES) {
    assert.ok(s.authorises.trim().length > 20, `${s.scope} does not say what it authorises`);
    assert.ok(
      /inside Steady|self-administered/i.test(s.authorises),
      `${s.scope} is described in a way that could be read as authorising a disclosure`
    );
  }
  assert.equal(mayDisclose(existing), false);
  assert.equal(mayDisclose([DISCLOSURE_SCOPE]), true, "the gate cannot be satisfied at all");
  assert.ok(refusalText().length > 100);
});

// ---------------------------------------------------------------------------
// Passive, and visible to the member
// ---------------------------------------------------------------------------

test("the compiler takes no curation parameter", () => {
  // §11's answer, checked on the signature rather than on the prose. A `pick`,
  // an `include` or an `omit` argument would be member curation reintroduced
  // through the back door.
  const src = code("lib/clinical/referral-packet.ts");
  const sig = src.slice(src.indexOf("export function compile("), src.indexOf("): ReferralPacket"));
  for (const smell of ["include", "omit", "pick", "selected", "chosen"]) {
    assert.ok(!sig.includes(smell), `compile() takes a ${smell} parameter, which is curation`);
  }
});

test("the store compiles only from records that already exist", () => {
  // Passive compilation means nothing is asked for at the moment of referral.
  // A store that wrote anything would be collecting, not compiling.
  const store = code("lib/clinical/referral-packet-store.ts");
  assert.ok(!/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/i.test(store), "the compiler writes");
  // And it reads inside the tenant, like every other read of a person's record.
  assert.match(store, /tenant_id = \?/, "the packet is assembled without a tenant scope");
});

test("the member can read the whole packet, which is the condition the decision attached", () => {
  const page = code("app/app/settings/referral/page.tsx");
  assert.match(page, /packet\.sections\.map\(/, "the member is not shown the contents");
  assert.match(page, /packet\.excluded\.map\(/, "the member is not shown the exclusions");
  assert.match(page, /\{packet\.refusal\}/, "the member is not told it cannot be sent");
  assert.match(page, /requireMember\(/);
  // The scope list is the VOCABULARY, and must not be headed as though it were
  // this member's own consents — it listed scopes they had never been asked for
  // under "What you have agreed to".
  assert.ok(
    !/What you have agreed to/.test(page),
    "the scope vocabulary is presented as the member's own consents"
  );
  assert.match(page, /Every consent Steady can ask for/);
  // Reachable, not merely present.
  assert.match(code("lib/app/route-register.ts"), /path: "\/app\/settings\/referral"/);
  assert.match(code("app/app/settings/page.tsx"), /\/app\/settings\/referral/, "nothing links to it");
});

test("no surface offers a send control", () => {
  // A disabled button implies the rest is built and somebody merely has to
  // enable it. Both blockers are absences.
  for (const rel of ["app/app/settings/referral/page.tsx", "app/clinician/referrals/page.tsx"]) {
    const src = code(rel);
    assert.ok(!/<button/i.test(src), `${rel} renders a control on a capability that does not exist`);
    assert.ok(!/<form/i.test(src), `${rel} renders a form on a capability that does not exist`);
  }
});
