import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  EVIDENCE_CLAIMS, resolveClaim, claimsFor, claimById,
  EVIDENCE_TYPE_LABEL, type EvidenceClaim,
} from "../src/lib/governance/evidence-registry";

// The governed evidence registry (17 September handoff, P5).
//
//   "Generate every public claim and count from one governed evidence registry.
//   Do not maintain separate numbers in page copy."
//
// The finding is about somebody else's product and lands squarely on this one:
// two pages quoting the same body of work and disagreeing about how much of it
// there is. Steady had the same shape in miniature — the public evidence page
// carried counts written into prose ("eighteen isolation cases and twelve
// transaction cases"), right when typed and checked by nobody.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");

const TODAY = "2026-09-18";
const claim = (over: Partial<EvidenceClaim> = {}): EvidenceClaim => ({
  claimId: "t.1", publicText: "A claim.", productScope: "Steady", productVersion: "v1",
  population: "Nobody", evidenceType: "software_verification", sourceIds: ["npm test"],
  resultSummary: "It passed.", limitations: "It covers the cases written.",
  allowedSurfaces: ["/evidence"], approvalStatus: "approved",
  approvedBy: "Somebody", reviewedAt: "2026-09-01",
  ...over,
});

// ---------------------------------------------------------------------------
// Fails closed
// ---------------------------------------------------------------------------

test("an expired claim does not render, and is not quietly extended", () => {
  // THE LOAD-BEARING ONE. "Remove or mark expired claims automatically at
  // render time. Do not silently extend approval."
  const r = resolveClaim(claim({ expiresAt: "2026-09-17" }), { surface: "/evidence", asOf: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.refusals.join(" "), /expired on 2026-09-17/);
  assert.match(r.refusals.join(" "), /needs reviewing again, not extending/);
});

test("a claim expiring today still renders, and tomorrow's does not", () => {
  const onTheDay = resolveClaim(claim({ expiresAt: TODAY }), { surface: "/evidence", asOf: TODAY });
  assert.equal(onTheDay.ok, true, "an approval is good until the end of the day it expires");
  const after = resolveClaim(claim({ expiresAt: TODAY }), { surface: "/evidence", asOf: "2026-09-19" });
  assert.equal(after.ok, false);
});

test("a draft or withdrawn claim is published nowhere", () => {
  for (const status of ["draft", "withdrawn"] as const) {
    const r = resolveClaim(claim({ approvalStatus: status }), { surface: "/evidence", asOf: TODAY });
    assert.equal(r.ok, false, `a ${status} claim resolved`);
  }
});

test("a claim approved for one surface is not thereby approved for another", () => {
  // A claim cleared for the trust page is not cleared for a payer deck.
  const r = resolveClaim(claim({ allowedSurfaces: ["/trust"] }), { surface: "/payer/evidence", asOf: TODAY });
  assert.equal(r.ok, false);
  assert.match(r.refusals.join(" "), /approved for \/trust and this is \/payer\/evidence/);
});

test("a claim with no approver, no review date or no limitation is refused", () => {
  for (const missing of [
    { approvedBy: undefined },
    { reviewedAt: undefined },
    { limitations: "   " },
  ]) {
    const r = resolveClaim(claim(missing), { surface: "/evidence", asOf: TODAY });
    assert.equal(r.ok, false, `resolved with ${JSON.stringify(missing)}`);
  }
});

test("every refusal says which claim and why, so an author can act on it", () => {
  const r = resolveClaim(
    claim({ claimId: "x.y", approvalStatus: "draft", expiresAt: "2020-01-01" }),
    { surface: "/nowhere", asOf: TODAY },
  );
  assert.ok(r.refusals.length >= 3);
  for (const reason of r.refusals) assert.match(reason, /x\.y/);
});

// ---------------------------------------------------------------------------
// The registry itself
// ---------------------------------------------------------------------------

test("every claim in the registry resolves on a surface it names", () => {
  for (const c of EVIDENCE_CLAIMS) {
    assert.ok(c.allowedSurfaces.length > 0, `${c.claimId} is approved for no surface`);
    const r = resolveClaim(c, { surface: c.allowedSurfaces[0], asOf: TODAY });
    assert.deepEqual(r.refusals, [], `${c.claimId} does not resolve: ${r.refusals.join(" ")}`);
  }
});

test("every claim names what it is about, and the method claim is not about Steady", () => {
  // THE FIELD THAT MATTERS MOST. A registry that could not say "this is about
  // the method as clinicians practise it" would be a machine for laundering
  // method evidence into product evidence.
  const method = claimById("method.emdr-has-published-support")!;
  assert.match(method.productScope, /not Steady/);
  assert.equal(method.evidenceType, "research");
  for (const c of EVIDENCE_CLAIMS) {
    assert.ok(c.productScope.trim().length > 3, `${c.claimId} does not say what it is about`);
    assert.ok(c.population.trim().length > 3, `${c.claimId} does not say who it is about`);
    assert.ok(c.sourceIds.length > 0, `${c.claimId} rests on nothing checkable`);
  }
});

test("a claim that nothing exists is not labelled as research", () => {
  // The rendered page read "Published research · about Steady" over the
  // sentence "that evidence does not transfer to Steady" — a claim about the
  // ABSENCE of research, labelled as research about the product, on the one
  // page whose whole job is keeping those two apart.
  const c = claimById("method.does-not-transfer")!;
  assert.equal(c.evidenceType, "absence_of_evidence");
  assert.equal(EVIDENCE_TYPE_LABEL.absence_of_evidence, "No evidence exists");
  assert.notEqual(EVIDENCE_TYPE_LABEL.absence_of_evidence, EVIDENCE_TYPE_LABEL.research);
});

test("the four kinds of evidence stay distinct, and so does the fifth", () => {
  // The handoff names four. Most of Steady's claims are none of them: they are
  // statements about software backed by a command anybody can run, and calling
  // those "product telemetry" would describe a passing suite as operational
  // data about real use.
  const kinds = new Set(EVIDENCE_CLAIMS.map((c) => c.evidenceType));
  assert.ok(kinds.has("research"));
  assert.ok(kinds.has("software_verification"));
  for (const k of kinds) assert.ok(EVIDENCE_TYPE_LABEL[k], `${k} has no label`);
  assert.notEqual(EVIDENCE_TYPE_LABEL.software_verification, EVIDENCE_TYPE_LABEL.product_telemetry);
});

test("claim ids are unique", () => {
  const ids = EVIDENCE_CLAIMS.map((c) => c.claimId);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// The counts that used to live in prose
// ---------------------------------------------------------------------------

test("a count inside a claim is checked against the thing that produces it", () => {
  // "Eighteen isolation cases and twelve transaction cases" was right when
  // typed and wrong the moment somebody added a test. The number is a field
  // now, and this counts the file.
  const counted = EVIDENCE_CLAIMS.filter((c) => c.countedFrom);
  assert.ok(counted.length > 0, "no claim declares where its number comes from");
  for (const c of counted) {
    const src = read(c.countedFrom!.source);
    const actual = (src.match(/^test\(/gm) ?? []).length;
    assert.equal(actual, c.countedFrom!.count,
      `${c.claimId} says ${c.countedFrom!.count} and ${c.countedFrom!.source} has ${actual}`);
  }
});

test("no claim writes a bare count into its public text", () => {
  // The whole instruction: "do not maintain separate numbers in page copy."
  const numbers = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\d+)\s+(cases|tests|checks|studies|members|people|routes)\b/i;
  for (const c of EVIDENCE_CLAIMS) {
    assert.doesNotMatch(c.publicText, numbers,
      `${c.claimId} counts something in its public text: "${c.publicText}"`);
  }
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test("the evidence page has no claim sentences of its own", () => {
  // There is nowhere to put one: the lists it used to read are gone, and every
  // rendered claim comes through the registry's resolution.
  const page = code(read("src/app/evidence/page.tsx"));
  assert.match(page, /claimsFor\(EVIDENCE_CLAIMS, \{ surface: "\/evidence", asOf \}\)/);
  assert.doesNotMatch(page, /EVIDENCE_METHOD|EVIDENCE_SOFTWARE|EVIDENCE_BLS/,
    "the page still reads an ungoverned claim list");
  const trust = read("src/lib/site/trust.ts");
  assert.doesNotMatch(trust, /export const EVIDENCE_SOFTWARE/,
    "the ungoverned list is still exported, so a page can go back to it");
});

test("a withheld claim is named on the page rather than silently dropped", () => {
  // A page that quietly gets shorter is how an expiry goes unnoticed.
  const page = code(read("src/app/evidence/page.tsx"));
  assert.match(page, /data-testid="withheld-claims"/);
  assert.match(page, /w\.refusals\.join\(" "\)/);
});

test("the gaps are not governed by claim approval", () => {
  // An approval that can expire would, on expiry, REMOVE a gap from the public
  // page. That is the one direction this page must never move in.
  const page = code(read("src/app/evidence/page.tsx"));
  assert.match(page, /EVIDENCE_NEEDED\.map/);
  assert.doesNotMatch(page, /claimsFor\(EVIDENCE_NEEDED/);
  const ids = EVIDENCE_CLAIMS.map((c) => c.claimId).join(" ");
  assert.doesNotMatch(ids, /needed|gap/);
});

test("the page shows every claim the registry clears for it", () => {
  // The other half of "no sentences of its own": nothing is dropped by a filter
  // the registry does not know about.
  const { shown } = claimsFor(EVIDENCE_CLAIMS, { surface: "/evidence", asOf: TODAY });
  const page = code(read("src/app/evidence/page.tsx"));
  const prefixes = [...new Set(shown.map((c) => c.claimId.split(".")[0]))];
  for (const p of prefixes) {
    assert.match(page, new RegExp(`startsWith\\("${p}\\.`),
      `claims with the ${p}. prefix resolve for this page and nothing renders them`);
  }
});
