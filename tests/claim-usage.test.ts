// Where a claim has already gone (17 September handoff, P5: "Record every
// export or publication version that used a claim").
//
// THE REGISTRY ALREADY FAILS CLOSED GOING FORWARD. What it could not do is
// answer the question asked the day a claim is withdrawn: what already left
// carrying it, and what did it say at the time? Withdrawing a claim stops it
// rendering and recalls nothing.
//
// So these tests are about the properties that make the answer usable: the
// words survive the source changing, one publication version writes one row
// however many people read it, and an export cannot carry a claim's sentence
// out of the building without the record writing itself.

process.env.EMDR_DATA_DIR = `/tmp/steady-claimuse-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "claim-usage-test-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "claim-usage-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  claimVersion, recordClaimUse, recordPublication, claimsUsedIn, usesOfClaim,
  claimUsageLedger, groupUsage, buildIdentity, type ClaimUsageRow,
} from "../src/lib/governance/claim-usage";
import { EVIDENCE_CLAIMS, type EvidenceClaim } from "../src/lib/governance/evidence-registry";
import { createExport } from "../src/lib/intelligence/export";
import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { data } from "../src/lib/data";

const CLAIM: EvidenceClaim = {
  claimId: "test.claim",
  publicText: "Steady does a specific thing, and this is the sentence that says so.",
  productScope: "Steady",
  productVersion: "steady-test",
  population: "Nobody — fabricated",
  evidenceType: "software_verification",
  sourceIds: ["npm run test:safety"],
  resultSummary: "The suite passes.",
  limitations: "Says nothing about anybody's care.",
  allowedSurfaces: ["/evidence"],
  approvalStatus: "approved",
  approvedBy: "A person",
  reviewedAt: "2026-09-18",
};

test("the version covers the approval, not only the words", () => {
  const base = claimVersion(CLAIM);

  // A CHANGE TO THE SENTENCE IS A NEW VERSION — the obvious half.
  assert.notEqual(base, claimVersion({ ...CLAIM, publicText: CLAIM.publicText + " Also this." }));

  // AND SO IS A CHANGE TO WHAT STANDS BEHIND IT. This is the half a hash over
  // publicText would have missed: identical words, and the claim now expires,
  // or may appear somewhere new, or rests on different evidence. "Which
  // version of this claim was published" is a question about the approval.
  assert.notEqual(base, claimVersion({ ...CLAIM, expiresAt: "2027-01-01" }));
  assert.notEqual(base, claimVersion({ ...CLAIM, allowedSurfaces: ["/evidence", "/trust"] }));
  assert.notEqual(base, claimVersion({ ...CLAIM, approvalStatus: "withdrawn" }));
  assert.notEqual(base, claimVersion({ ...CLAIM, limitations: "Something else entirely." }));
  assert.notEqual(base, claimVersion({ ...CLAIM, reviewedAt: "2026-09-19" }));

  // Ordering of the two list fields is not a version change: a reordered
  // surface list is the same approval, and a hash that disagreed would fill
  // the ledger with versions nobody changed.
  assert.equal(
    claimVersion({ ...CLAIM, allowedSurfaces: ["/trust", "/evidence"] }),
    claimVersion({ ...CLAIM, allowedSurfaces: ["/evidence", "/trust"] }),
  );
});

test("one publication version writes one row, however many times it renders", async () => {
  getDb();
  const first = await recordPublication([CLAIM], { surface: "/evidence", at: "2026-09-18 09:00:00" });
  assert.equal(first, undefined);

  // Nine more renders of the same words on the same build.
  for (let i = 0; i < 9; i++) {
    await recordPublication([CLAIM], { surface: "/evidence", at: "2026-09-18 09:0" + i + ":00" });
  }

  const uses = await usesOfClaim("test.claim");
  assert.equal(uses.length, 1, "a public page must not write a row per reader");
  assert.equal(uses[0].firstUsedAt, "2026-09-18 09:00:00", "the FIRST use is the one kept");
  assert.equal(uses[0].vehicle, "publication");
  assert.equal(uses[0].reference, "/evidence");

  // A new version of the same claim is a second row, not an overwrite. This is
  // the whole point: the ledger has to hold both.
  const reworded = { ...CLAIM, publicText: "Steady does the thing, said differently." };
  await recordPublication([reworded], { surface: "/evidence", at: "2026-09-19 09:00:00" });
  const after = await usesOfClaim("test.claim");
  assert.equal(after.length, 2);
  assert.deepEqual(
    after.map((u) => u.publicText),
    [CLAIM.publicText, reworded.publicText],
    "the earlier words are still readable after the source stopped saying them",
  );
});

test("recordClaimUse says whether it was the one that wrote", async () => {
  getDb();
  const use = {
    claimId: "test.dedupe",
    claimVersion: "v1",
    vehicle: "publication" as const,
    reference: "/trust",
    productVersion: "abc1234",
    publicText: "Words.",
    firstUsedAt: "2026-09-18 10:00:00",
  };
  assert.equal(await recordClaimUse(use), "recorded");
  assert.equal(await recordClaimUse(use), "already recorded");
  // A ROW COUNT WOULD NOT HAVE CAUGHT A BROKEN DEDUPE that silently replaced
  // the row instead of skipping it, which is why the function reports which
  // happened rather than the caller counting afterwards.
  const rows = await usesOfClaim("test.dedupe");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstUsedAt, "2026-09-18 10:00:00");
});

test("a publication failure does not take the public page down with it", async () => {
  // THE ONE PLACE THE GOVERNANCE CODE SWALLOWS AN ERROR, and the reason is on
  // the function: the surfaces carrying claims are public pages, and a public
  // page is also how somebody reaches the crisis link. A bookkeeping insert
  // must not be able to put an error page in front of that.
  const broken = { ...CLAIM, claimId: null as unknown as string };
  await recordPublication([broken], { surface: "/evidence" });
  // Reaching here at all is the assertion: recordPublication resolved rather
  // than throwing on a row the database refuses.
  assert.ok(true);
});

test("an export carrying a claim's words records it, without being told", async () => {
  getDb();
  const c = await data();
  const user = (await c.get("SELECT id FROM users LIMIT 1", [])) as { id: string };

  // A REAL REGISTRY CLAIM, put into the file the way a careless edit would put
  // one there: as data, with nobody passing a claim id anywhere.
  const claim = EVIDENCE_CLAIMS.find((x) => x.approvalStatus === "approved")!;
  const result = await createExport({
    tenantId: PLATFORM_TENANT_ID,
    requestedBy: user.id,
    requestedByRole: "admin",
    surface: "test/claim-carrying",
    cohortVersion: "cohort.vTest",
    filter: { scope: "all" },
    countColumns: ["people"],
    rows: [{ note: claim.publicText, people: 40 }],
    purpose: "Checking that a file carrying a public claim records which version it carried",
  });

  const uses = await usesOfClaim(claim.claimId);
  const forThisExport = uses.filter((u) => u.reference === result.id);
  assert.equal(forThisExport.length, 1, "an export embedding a claim must record the use");
  assert.equal(forThisExport[0].vehicle, "export");
  assert.equal(forThisExport[0].claimVersion, claimVersion(claim));
  assert.equal(forThisExport[0].publicText, claim.publicText);
  assert.equal(forThisExport[0].productVersion, buildIdentity());
});

test("an export carrying no claim records nothing", async () => {
  getDb();
  const c = await data();
  const user = (await c.get("SELECT id FROM users LIMIT 1", [])) as { id: string };
  const before = (await claimUsageLedger()).length;
  const result = await createExport({
    tenantId: PLATFORM_TENANT_ID,
    requestedBy: user.id,
    requestedByRole: "admin",
    surface: "test/plain",
    cohortVersion: "cohort.vTest",
    filter: { scope: "all" },
    countColumns: ["people"],
    rows: [{ site: "North", people: 40 }],
    purpose: "An ordinary cohort export that quotes nothing from the registry",
  });
  const after = await claimUsageLedger();
  assert.equal(after.length, before, "an ordinary export must not invent a use");
  assert.equal(after.filter((u) => u.reference === result.id).length, 0);
});

test("the scan matches the words, and does not launder a paraphrase into a record", () => {
  const claim = EVIDENCE_CLAIMS[0];
  assert.deepEqual(
    claimsUsedIn(`prefix ${claim.publicText} suffix`, EVIDENCE_CLAIMS).map((c) => c.claimId),
    [claim.claimId],
  );
  // A PARAPHRASE IS A SEPARATE DEFECT. The registry's rule is that nothing
  // paraphrases a claim, so recording a near-match as a use would record
  // approval for words nobody approved.
  const nearly = claim.publicText.replace(/\.$/, "") + " (roughly).";
  assert.deepEqual(claimsUsedIn(nearly, EVIDENCE_CLAIMS), []);
  assert.deepEqual(claimsUsedIn("nothing from the registry is in here", EVIDENCE_CLAIMS), []);
});

test("the ledger groups by claim and then by version, newest version first", () => {
  const row = (over: Partial<ClaimUsageRow>): ClaimUsageRow => ({
    id: Math.random().toString(36).slice(2),
    claimId: "a.claim",
    claimVersion: "v1",
    vehicle: "publication",
    reference: "/evidence",
    productVersion: "aaa1111",
    publicText: "Old words.",
    firstUsedAt: "2026-01-01 00:00:00",
    ...over,
  });
  const grouped = groupUsage([
    row({}),
    row({ claimVersion: "v2", publicText: "New words.", firstUsedAt: "2026-06-01 00:00:00" }),
    row({ claimVersion: "v2", publicText: "New words.", vehicle: "export", reference: "exp-1", firstUsedAt: "2026-07-01 00:00:00" }),
    row({ claimId: "b.claim" }),
  ]);
  assert.deepEqual(grouped.map((g) => g.claimId), ["a.claim", "b.claim"]);
  assert.deepEqual(grouped[0].versions.map((v) => v.claimVersion), ["v2", "v1"]);
  assert.equal(grouped[0].versions[0].uses.length, 2);
  assert.deepEqual(
    grouped[0].versions[0].uses.map((u) => u.vehicle),
    ["publication", "export"],
    "uses within a version read oldest first — the order they actually happened",
  );
  assert.equal(grouped[0].versions[1].publicText, "Old words.");
});

test("the build a publication came from is recorded, and says so when it cannot be identified", () => {
  const id = buildIdentity();
  assert.ok(id.length > 0);
  // NOT A PLACEHOLDER THAT READS LIKE A COMMIT. When nothing reports one, the
  // row has to say the build was unidentified rather than carry a value a
  // reader would take for evidence.
  if (!process.env.RENDER_GIT_COMMIT && !process.env.EMDR_BUILD_COMMIT) {
    assert.equal(id, "unidentified-build");
  }
});
