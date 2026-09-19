// FAILURE-INJECTION EVIDENCE for the failure register's
// `presentation.provider-fails-and-queue-looks-empty`,
// `presentation.export-filter-changes-during-generation`,
// `tenancy.suggestion-crosses-scope` and
// `tenancy.several-queries-infer-a-small-group`
// — see src/lib/governance/failure-register.ts.
//
// TWO FAMILIES OF FAILURE THAT LOOK LIKE SUCCESS. A screen that read one source
// of three and shows a number; a file that was generated from a filter nobody
// reviewed; a cached answer keyed on too little; a count small enough to name a
// person. None of them errors, and that is what makes them worth injecting.

process.env.EMDR_DATA_DIR = `/tmp/steady-partial-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "partial-test-key";
process.env.EMDR_SESSION_SECRET = "partial-test-secret-at-least-32-characters";

import { strict as assert } from "node:assert";
import test from "node:test";

import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  fullCoverage, partialCoverage, coverageNote, orientingCount,
} from "../src/lib/experience/role-home";
import { createExport, hashFilter, listExports } from "../src/lib/intelligence/export";
import { commandContextCacheKey } from "../src/lib/clinical/command-context";
import { COHORTS, registryVersion } from "../src/lib/metrics/cohorts";
import { SMALL_CELL } from "../src/components/charts/aggregate";

// ---------------------------------------------------------------------------
// A source fails and the screen shows a number anyway
// ---------------------------------------------------------------------------

test("a queue that read nothing does not say nothing needs review", () => {
  // THE INJECTION: every provider failed, so the queue is empty. "Nothing needs
  // review" and "nothing could be read" are opposite statements and look
  // identical as a zero — and the zero is in the headline, which is what
  // somebody glancing at a queue actually reads.
  const broken = partialCoverage([], [{ source: "attention signals", reason: "unavailable", lastGoodAt: null }]);
  const said = orientingCount({ total: 0, coverage: broken });

  assert.doesNotMatch(said, /^0 items need review/, "a partial read reported a complete-sounding zero");
  assert.match(said, /not a complete queue/);
  assert.match(said, /not the same as no work/);

  // And a complete read still says the plain thing. A headline that hedged
  // every time would teach people to ignore the hedge.
  assert.equal(orientingCount({ total: 0, coverage: fullCoverage(["a"]) }), "0 items need review.");
  // And it reads as English at one. The previous construction put the verb
  // outside the pluralisation and produced "1 item need review".
  assert.equal(orientingCount({ total: 1, coverage: fullCoverage(["a"]) }), "1 item needs review.");
});

test("a partial count says what it counted, at any size", () => {
  const broken = partialCoverage(["alerts"], [{ source: "caseload", reason: "timeout", lastGoodAt: null }]);
  assert.match(orientingCount({ total: 7, coverage: broken }), /from the sources that could be read/);
  assert.match(orientingCount({ total: 7, coverage: broken }), /More may exist/);
  assert.match(
    orientingCount({ total: 3, coverage: broken, groupLabel: "Needs attention" }),
    /Needs attention — 3 items from the sources that could be read/,
  );
});

test("the coverage note names the source and does not guess when it was last good", () => {
  const c = partialCoverage(["alerts"], [{ source: "caseload", reason: "timeout", lastGoodAt: null }]);
  const note = coverageNote(c)!;
  assert.match(note, /caseload/);
  assert.match(note, /may be incomplete/);
  // A LAST-GOOD READING NOBODY RECORDED IS NOT AVAILABLE TO INVENT. The note
  // omits it rather than printing a plausible date.
  assert.doesNotMatch(note, /last read/);
  assert.equal(coverageNote(fullCoverage(["alerts"])), null);
});

// ---------------------------------------------------------------------------
// The filter changes between the screen and the file
// ---------------------------------------------------------------------------

test("an export is bound to the filter it was given, not to one that changed after", async () => {
  getDb();
  const c = await data();
  const user = (await c.get("SELECT id FROM users LIMIT 1", [])) as { id: string };

  // THE INJECTION HAS TO LAND MID-FLIGHT, and a timer cannot do it here: the
  // database is synchronous behind promises, so the whole export resolves on
  // the microtask queue and a setTimeout fires only after it is done. So the
  // filter changes ON BEING READ — the first read returns what the screen was
  // showing, every read after it returns something wider. A hash taken at
  // entry binds the file to the reviewed filter; a hash taken at any later
  // point picks up the widened one.
  let reads = 0;
  const filter: Record<string, unknown> = {
    period: "2026-Q3",
    get scope() {
      reads++;
      return reads === 1 ? "site-north" : "every-site";
    },
  };
  const expected = hashFilter({ scope: "site-north", period: "2026-Q3" });
  const widened = hashFilter({ scope: "every-site", period: "2026-Q3" });
  assert.notEqual(expected, widened, "the fixture does not actually widen anything");

  const result = await createExport({
    tenantId: PLATFORM_TENANT_ID,
    requestedBy: user.id,
    requestedByRole: "admin",
    surface: "test/filter-binding",
    cohortVersion: "cohort.vTest",
    filter,
    countColumns: ["people"],
    rows: [{ site: "North", people: 40 }],
    purpose: "Checking that a file records the filter that was reviewed, not one that moved",
  });

  assert.ok(reads > 1, "the filter was read once, so nothing was injected");

  assert.equal(result.filterHash, expected, "the file's hash followed the caller's object after generation");
  const [recorded] = await listExports(PLATFORM_TENANT_ID, 1);
  assert.equal(recorded.filterHash, expected, "the disclosure record followed the filter that changed");
  assert.notEqual(result.filterHash, widened, "the file was bound to the widened filter");

  // And the file says which filter produced it, in the file — a CSV separated
  // from the screen that made it is the normal case.
  assert.match(result.csv, new RegExp(`# Filter hash: ${expected}`));
});

// ---------------------------------------------------------------------------
// Scope, in the cache as well as in the query
// ---------------------------------------------------------------------------

test("a cached answer cannot be served across a tenant, a person or a policy", () => {
  // "Prevent it at the server AND IN CACHE KEYS." The server-side checks are
  // attacked by the boundary suites; this is the other half, and it is the one
  // that fails silently — a key missing an input serves one person's assembled
  // drawer to a reader looking at somebody else.
  const base = {
    tenantId: "t1", personId: "p1", evidenceCutoff: "2026-09-18T09:00:00Z", signalId: "s1",
  };
  const key = commandContextCacheKey(base);

  for (const [field, value] of [
    ["tenantId", "t2"], ["personId", "p2"],
    ["evidenceCutoff", "2026-09-19T09:00:00Z"], ["signalId", "s2"],
  ] as const) {
    assert.notEqual(
      commandContextCacheKey({ ...base, [field]: value }),
      key,
      `two reads differing only in ${field} share a cache key`,
    );
  }
  // The same inputs are the same key, or nothing would ever be cached and the
  // check above would pass trivially.
  assert.equal(commandContextCacheKey({ ...base }), key);
});

// ---------------------------------------------------------------------------
// Several queries inferring a small group
// ---------------------------------------------------------------------------

test("the aggregate surface is a closed registry, not a query builder", () => {
  // "Several queries infer a small group → review complementary suppression and
  // differencing controls."
  //
  // DIFFERENCING IS NOT DEFEATED BY A PER-QUERY THRESHOLD: two permitted
  // queries whose difference is one person each pass it. What bounds it here is
  // that there is no query builder — an analyst chooses from a fixed set of
  // versioned cohort definitions and cannot compose a new one, so the set of
  // differences is finite, enumerable and reviewable rather than open.
  //
  // That is the control, and it is a property of the surface rather than a
  // filter, so it is asserted here where adding a free-text filter would break
  // it.
  assert.ok(COHORTS.length > 0, "no cohorts are defined at all");
  for (const cohort of COHORTS) {
    assert.ok(cohort.id && cohort.version, `${cohort.id} is not a versioned definition`);
  }
  // The registry version is derived from the definitions, so adding, removing
  // or altering one changes the identity of every file produced from the set.
  const before = registryVersion();
  assert.ok(before.length > 0);
  assert.equal(registryVersion(), before);

  // And the threshold below which a cell is withheld is one number, shared by
  // the screen and the file. Two thresholds would be a differencing attack with
  // no attacker.
  assert.ok(SMALL_CELL >= 2, "the small-cell threshold is not a threshold");
});
