// The page coverage matrix, and the columns nobody can fill (P7).
//
// The handoff asks for twelve things recorded per registered route. THE
// INTERESTING ANSWER IS WHICH COLUMNS ARE EMPTY: a matrix assembled by hand
// would be filled in, because a blank cell in a document looks like an
// oversight and the person filling it has a deadline. So every column is
// derived from a source that already exists, and a column with no source has to
// say so rather than being quietly dropped.

process.env.EMDR_DATA_DIR = `/tmp/steady-pagecov-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

import { strict as assert } from "node:assert";
import test from "node:test";

import { pageCoverage, coverageSummary, COLUMNS } from "../src/lib/review/page-coverage";
import { ROUTE_REGISTER, WORKSPACE_OWNER } from "../src/lib/app/route-register";

test("every registered route has a row, and every row answers every column one way", () => {
  const rows = pageCoverage();
  assert.equal(rows.length, ROUTE_REGISTER.length, "routes and rows have diverged");

  for (const row of rows) {
    for (const col of COLUMNS) {
      const cell = row[col.key];
      if (cell.known) {
        assert.ok(cell.value.length > 0, `${row.path} answers ${col.label} with nothing`);
      } else {
        // A CELL THAT CANNOT BE ANSWERED SAYS WHY. "Not recorded" with no reason
        // is the blank this file exists to prevent.
        assert.ok(
          cell.because.length > 15,
          `${row.path} cannot answer ${col.label} and does not say why`,
        );
      }
    }
  }
});

test("the columns nobody has filled are named, not omitted", () => {
  const summary = coverageSummary(pageCoverage());

  // These four are the honest state of this release and the test says so out
  // loud: two are writing nobody has done, two are a person nobody has booked.
  for (const label of ["Primary action", "Presentation states", "Keyboard evidence", "Screen-reader evidence"]) {
    assert.ok(
      summary.emptyColumns.includes(label),
      `${label} is now answered somewhere — move it out of the empty list rather than leaving a stale claim`,
    );
  }

  // And the ones that ARE answered are answered for every route, or the matrix
  // is reporting partial coverage as coverage.
  for (const label of ["Role", "Job", "Owner", "Permission boundary", "Limitations"]) {
    assert.equal(
      summary.answered[label], summary.routes,
      `${label} is answered for only ${summary.answered[label]} of ${summary.routes} routes`,
    );
  }
});

test("automated evidence is claimed only for routes the sweeps actually reach", () => {
  const rows = pageCoverage();
  const byPath = new Map(rows.map((r) => [r.path, r]));

  for (const route of ROUTE_REGISTER) {
    const row = byPath.get(route.path)!;
    if (route.state !== "working") {
      assert.equal(
        row.desktopEvidence.known, false,
        `${route.path} is ${route.state} and claims desktop evidence`,
      );
      continue;
    }
    // A DYNAMIC SEGMENT THE SWEEPS CANNOT RESOLVE IS UNSCANNED, and an
    // unscanned route that nobody lists is indistinguishable from a clean one.
    const resolvable = !route.path.includes("[") || route.path.startsWith("/clinician/member/[id]");
    assert.equal(
      row.narrowScreenEvidence.known, resolvable,
      `${route.path} claims narrow-screen evidence the sweeps do not produce`,
    );
  }
});

test("every route resolves to an accountable owner through its workspace", () => {
  for (const row of pageCoverage()) {
    assert.ok(row.owner.known && row.owner.value.length > 0, `${row.path} has no owner`);
  }
  for (const workspace of new Set(ROUTE_REGISTER.map((r) => r.workspace))) {
    assert.ok(WORKSPACE_OWNER[workspace], `workspace ${workspace} names nobody`);
  }
});

test("the build column is empty when the build cannot say what it is", () => {
  // The same honesty as the release definition's build line: evidence read
  // against a build that cannot identify itself is not evidence about a build.
  const saved = { render: process.env.RENDER_GIT_COMMIT, baked: process.env.EMDR_BUILD_COMMIT };
  delete process.env.RENDER_GIT_COMMIT;
  delete process.env.EMDR_BUILD_COMMIT;
  try {
    const row = pageCoverage()[0];
    assert.equal(row.verifiedCommit.known, false);
    assert.match(row.verifiedCommit.because, /reports no commit/);
  } finally {
    if (saved.render) process.env.RENDER_GIT_COMMIT = saved.render;
    if (saved.baked) process.env.EMDR_BUILD_COMMIT = saved.baked;
  }

  process.env.EMDR_BUILD_COMMIT = "0123456789abcdef0123456789abcdef01234567";
  try {
    assert.equal(pageCoverage()[0].verifiedCommit.known, true);
  } finally {
    if (saved.baked) process.env.EMDR_BUILD_COMMIT = saved.baked;
    else delete process.env.EMDR_BUILD_COMMIT;
  }
});
