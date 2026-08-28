// The member-surface boundary (Presentation Layer Handoff §0, §2, §3).
//
// The governing constraint, from Volume 2 and the Row 39–53 registry:
//
//   "Scores, diagnostic bands, criteria labels, and hidden track names are not
//    displayed to members… If any surface in the product contradicts this
//    paragraph, it is a defect."
//
// And on the readiness score specifically, "keep score hidden" appears on every
// readiness row.
//
// The handoff's engineering requirement is the important part, and it is why
// this is a test rather than a review checklist:
//
//   "Build the member renderer so it is STRUCTURALLY INCAPABLE of receiving a
//    score. The API that serves the member surface should not return score
//    fields at all — not hidden, not null, not filtered client-side. If a score
//    never crosses the boundary, leakage becomes impossible rather than merely
//    prohibited."
//
// So there are two halves here. The first scans member route source for the
// identifiers that carry forbidden values, which catches a leak in the commit
// that introduces it. The second asserts the member view model itself cannot
// hold one, which is what makes the first half hard to defeat: a page cannot
// render a score it was never handed.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const APP = path.join(process.cwd(), "src", "app");

/** Every route a member can reach while signed in. */
// Addresses per the Web GUI handoff §26 atlas: the member surfaces moved under
// /app, and two were renamed (dashboard -> today, practices -> activities).
// Same twelve surfaces, same coverage — only the paths changed.
const MEMBER_ROUTES = [
  "app/today", "app/check-in", "app/session", "app/paths", "app/ground", "app/learn",
  "app/activities", "app/companion", "app/measures", "app/screening", "app/onboarding",
  "app/settings",
];

/** Identifiers that carry a score, a band, a track, or a criteria label.
 *  Presence in member route source is a defect per Vol 2 — the value has
 *  reached the surface even if a reader might not recognise it. */
const FORBIDDEN = [
  { rx: /\btotal_score\b/, what: "an instrument total score" },
  { rx: /\bcalculated_readiness_score\b/, what: "the readiness score" },
  { rx: /\brecommended_track\b/, what: "the hidden track name" },
  { rx: /\bTRACK_LABELS\b/, what: "the track label map" },
  { rx: /\bTRACK_GUIDANCE\b/, what: "track-specific guidance, which reveals the track" },
  { rx: /\bTrendChart\b/, what: "a trend chart over time" },
  { rx: /\bMemberTrajectory\b/, what: "the clinical trajectory chart" },
  { rx: /\bscoreItq\b/, what: "instrument scoring" },
  { rx: /\bpclSeverity\b|\bseverityBand\b/, what: "a diagnostic band" },
  { rx: /\breadinessScore\b/, what: "the readiness score" },
  // Found on the screening page: "10+ suggests moderate depression; item 9
  // above zero always routes to specialist review." That is a cutoff AND a
  // criteria label, and it also tells someone how to answer to avoid a
  // consequence — which corrupts the instrument as well as breaking Vol 2.
  { rx: /\bcutoffNote\b/, what: "an instrument cutoff note" },
  { rx: /\.cutoff\b/, what: "an instrument cutoff" },
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Strip comments — a comment explaining why a value is forbidden must not
 *  itself trip the rule. */
function prose(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const memberFiles = MEMBER_ROUTES.flatMap((r) =>
  walk(path.join(APP, r)).map((p) => ({ route: r, file: path.relative(APP, p), src: fs.readFileSync(p, "utf8") }))
);

test("the member routes under guard actually exist", () => {
  const missing = MEMBER_ROUTES.filter((r) => !fs.existsSync(path.join(APP, r)));
  assert.deepEqual(missing, [], `member routes are missing: ${missing.join(", ")}`);
  assert.ok(memberFiles.length >= 12, `only found ${memberFiles.length} member files`);
});

// ---------------------------------------------------------------------------
// §2 Leakage — no score, band, track, or chart reaches a member surface
// ---------------------------------------------------------------------------

test("no member surface renders a score, a band, a track name, or a chart", () => {
  const leaks: string[] = [];
  for (const f of memberFiles) {
    const text = prose(f.src);
    for (const { rx, what } of FORBIDDEN) {
      if (rx.test(text)) leaks.push(`${f.file} — ${what}`);
    }
  }
  assert.deepEqual(
    leaks, [],
    "these member surfaces carry values Vol 2 forbids:\n  " + leaks.join("\n  ") +
    "\nA score must not reach the member renderer at all. Serve the surface from " +
    "src/lib/member/view.ts, which cannot carry one."
  );
});

test("no member surface selects a score-bearing column", () => {
  // The structural half: the boundary only holds if the value never arrives.
  //
  // Scoped to COLUMNS rather than tables. A member surface may legitimately ask
  // whether or when an instrument was taken — "due in 3 days" needs a date, and
  // a date is not a score. What it may never do is pull the score itself, the
  // raw answers (from which a score can be recomputed), or SELECT * across a
  // score-bearing table, which sweeps the score in by accident.
  const SCORE_TABLE = /\b(screenings|readiness_assessments)\b/i;
  const SCORE_COLUMN = /\b(total_score|answers_json|calculated_readiness_score|recommended_track)\b/i;
  const SELECT_STAR = /SELECT\s+(?:[a-z]+\.)?\*\s+FROM\s+(screenings|readiness_assessments)\b/i;

  const offenders: string[] = [];
  for (const f of memberFiles) {
    const text = prose(f.src);
    if (SCORE_TABLE.test(text) && SCORE_COLUMN.test(text)) {
      offenders.push(`${f.file} — selects a score-bearing column`);
    }
    if (SELECT_STAR.test(text)) {
      offenders.push(`${f.file} — SELECT * over a score-bearing table`);
    }
  }
  assert.deepEqual(
    offenders, [],
    "these member surfaces put a score in scope:\n  " + offenders.join("\n  ") +
    "\nAsk when it was taken, never what it said."
  );
});

// ---------------------------------------------------------------------------
// §3 The view model is structurally incapable of carrying a score
// ---------------------------------------------------------------------------

test("the member view model exposes no field that could hold a score", async () => {
  const { buildMemberDay, MEMBER_DAY_KEYS, FORBIDDEN_DAY_KEYS } =
    await import("../src/lib/member/view");

  // The allowed keys are enumerated, so adding a field is a deliberate act that
  // shows up in a diff rather than an accident that ships.
  for (const k of MEMBER_DAY_KEYS) {
    assert.ok(
      !FORBIDDEN_DAY_KEYS.some((f) => k.toLowerCase().includes(f)),
      `the member day model exposes "${k}", which reads as a score-bearing field`
    );
  }
  assert.equal(typeof buildMemberDay, "function");
});

test("a built member day contains no numeric field beyond counts of things", async () => {
  const { assertNoScores } = await import("../src/lib/member/view");
  // A hand-built day carrying a stray score must be rejected at runtime, not
  // merely absent by convention — the assertion is the boundary.
  assert.throws(
    () => assertNoScores({ shape: "open", readinessScore: 68 } as never),
    /score/i,
    "a score passed through the member boundary unnoticed"
  );
  assert.throws(
    () => assertNoScores({ shape: "open", track: "gentle_processing" } as never),
    /track/i,
    "a track name passed through the member boundary unnoticed"
  );
  assert.doesNotThrow(() =>
    assertNoScores({ shape: "open", practices: [], primary: null, messageKey: "day.open", humanSupport: true } as never)
  );
});

test("no member surface renders a streak or a running count", () => {
  // §8 names "dates-as-streak, counts, charts" as things the history strip must
  // never receive. This rule was missing from the first version of this guard,
  // and the dashboard was shipping "Check-ins so far — 12" underneath it.
  //
  // A streak is a score with a friendlier name. It creates the same performance
  // pressure, and it turns a missed day — often a bad day, the day this product
  // exists for — into a number the member is shown when they come back.
  const COUNTERS = [
    { rx: /COUNT\(\*\)[\s\S]{0,80}FROM\s+(checkins|therapy_sessions|practice_completions|lesson_reads)\b/i,
      what: "a running count of member activity" },
    { rx: /\bstreak\b/i, what: "a streak" },
    { rx: />\s*\{?\s*\w*(?:count|total)\w*\.n\b/i, what: "a rendered count" },
  ];
  const offenders: string[] = [];
  for (const f of memberFiles) {
    const text = prose(f.src);
    for (const { rx, what } of COUNTERS) {
      if (rx.test(text)) offenders.push(`${f.file} — ${what}`);
    }
  }
  assert.deepEqual(offenders, [],
    "these member surfaces render a streak or a count:\n  " + offenders.join("\n  ") +
    "\nShow what happened, never how much or how many days in a row.");
});

// ---------------------------------------------------------------------------
// §2 Denial framed as failure, and §4's rendering rule for narrowing
// ---------------------------------------------------------------------------

test("a narrowed day is never rendered as a locked or greyed-out card", () => {
  // "Absent is absent. A locked card is a scoreboard of what you failed to
  // unlock." The handoff calls this its single most important line.
  const LOCK_PATTERNS = [
    { rx: /\bpadlock\b|🔒|\bLockIcon\b/i, what: "a padlock" },
    { rx: /className="[^"]*\bopacity-(?:2[05]|30|40|50)\b[^"]*"[^>]*>\s*\{?[^<]*\b(?:locked|unavailable)/i, what: "a greyed-out unavailable card" },
    { rx: /\bLocked\b(?!\s*(?:card is|means))/, what: "a locked label" },
  ];
  const offenders: string[] = [];
  for (const f of memberFiles) {
    const text = prose(f.src);
    for (const { rx, what } of LOCK_PATTERNS) {
      if (rx.test(text)) offenders.push(`${f.file} — ${what}`);
    }
  }
  assert.deepEqual(offenders, [],
    "a narrowed day must show what IS available, never what is withheld:\n  " + offenders.join("\n  "));
});

// ---------------------------------------------------------------------------
// §7 No alarm colour on a member surface
// ---------------------------------------------------------------------------

test("no member surface uses an alarm colour", () => {
  // "High-vibrancy red is processed as threat, which is the wrong
  // physiological response to trigger in this population — including on the
  // crisis screen, where the member is already activated."
  //
  // The clinician console is deliberately out of scope: it is an instrument
  // read by a professional, not a screen someone meets at 2am.
  // Amber is deliberately NOT here. §7 permits it — "appears only for attention
  // states and never for alarm" — and banning it would fail a 20%-opacity
  // decorative wash, which is texture rather than signal. Amber's own rule is
  // about spread, and it is asserted separately below.
  const ALARM = /\b(?:bg|text|border|ring)-(?:support|red|orange|rose)(?:-\w+)?\b/;
  // Shared components count. The SOS button lived in one and escaped the first
  // sweep of this guard entirely — it is the single most member-facing control
  // in the product and it was still bright red.
  const COMPONENTS = path.join(process.cwd(), "src", "components");
  const componentFiles = fs.existsSync(COMPONENTS)
    ? fs.readdirSync(COMPONENTS)
        .filter((n) => n.endsWith(".tsx"))
        .map((n) => ({ route: "components", file: `components/${n}`, src: fs.readFileSync(path.join(COMPONENTS, n), "utf8") }))
    : [];

  const offenders: string[] = [];
  for (const f of [
    ...memberFiles,
    ...componentFiles,
    { route: "crisis", file: "crisis/page.tsx", src: readIf("crisis/page.tsx") },
  ]) {
    if (!f.src) continue;
    const m = ALARM.exec(prose(f.src));
    if (m) offenders.push(`${f.file} — ${m[0]}`);
  }
  assert.deepEqual(offenders, [],
    "these member-facing surfaces use an alarm colour:\n  " + offenders.join("\n  ") +
    "\nCrisis carries weight through contrast and typography, not through red.");
});

test("amber has not spread beyond a couple of surfaces", () => {
  // §7: "--steady-amber appears only for attention states and never for alarm;
  // if it starts showing up on more than a couple of surfaces, that's a signal
  // the design has drifted." Encoded as written — a soft cap, not a ban, so
  // the failure tells you to look rather than to delete.
  const AMBER = /\b(?:bg|text|border|ring)-(?:amber|pause)(?:-\w+)?\b/;
  const using = memberFiles.filter((f) => AMBER.test(prose(f.src))).map((f) => f.file);
  assert.ok(
    using.length <= 6,
    `amber/attention colour now appears on ${using.length} member surfaces: ${using.join(", ")}. ` +
    "That is the drift signal §7 describes — check that each one is genuinely an attention state."
  );
});

function readIf(rel: string): string {
  const p = path.join(APP, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

// ---------------------------------------------------------------------------
// §8 Component contracts
// ---------------------------------------------------------------------------

test("the member components exist and take only what their contract allows", () => {
  const DIR = path.join(process.cwd(), "src", "components", "member");
  assert.ok(fs.existsSync(DIR), "src/components/member does not exist");

  const src = fs.readdirSync(DIR)
    .filter((n) => n.endsWith(".tsx"))
    .map((n) => fs.readFileSync(path.join(DIR, n), "utf8"))
    .join("\n");

  for (const c of ["DayCanvas", "PracticeCard", "HistoryStrip", "Horizon"]) {
    assert.ok(new RegExp(`function ${c}\\b`).test(src), `${c} is not defined`);
  }

  // §8's "must never receive" column, enforced on the props rather than left
  // as documentation. A component that cannot name a score cannot render one.
  const props = [...prose(src).matchAll(/\{([^}]*)\}\s*:\s*\{([^}]*)\}/g)]
    .map((m) => m[2])
    .join(" ");
  for (const forbidden of ["score", "band", "track", "severity", "reason", "ruleId", "streak", "count"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\w*\\s*[?:]`, "i").test(props),
      `a member component accepts "${forbidden}" as a prop, which §8 forbids`
    );
  }
});

test("the horizon is stateless — it cannot become a trend chart", () => {
  const f = path.join(process.cwd(), "src", "components", "member", "DayCanvas.tsx");
  const src = prose(fs.readFileSync(f, "utf8"));
  const horizon = src.slice(src.indexOf("function Horizon"), src.indexOf("function PracticeCard"));

  // §7's boundary condition: "a single static position per day is a state
  // indicator. The moment you animate it across days, show history, or let a
  // member scrub back through it, it becomes a trend chart and violates Vol 2."
  for (const banned of ["history", "days", "range", "series", "previous", "animate", "transition"]) {
    assert.ok(
      !new RegExp(`\\b${banned}\\b`, "i").test(horizon),
      `the horizon references "${banned}" — a horizon that spans more than today is a chart`
    );
  }
});

// ---------------------------------------------------------------------------
// The history strip — what replaces the forbidden charts
// ---------------------------------------------------------------------------

test("the history strip carries completed practices, never counts or streaks", async () => {
  const { HISTORY_FORBIDDEN } = await import("../src/lib/member/history");
  // "dates-as-streak, counts, charts" are named as things HistoryStrip must
  // never receive. A streak is a score with a friendlier name: it creates the
  // same performance pressure, and missing a day becomes a visible failure.
  for (const f of ["streak", "count", "total", "percent", "score", "average"]) {
    assert.ok(
      (HISTORY_FORBIDDEN as readonly string[]).includes(f),
      `"${f}" is not declared forbidden on the history strip`
    );
  }
});
