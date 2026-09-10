// The member shell (handoff 09 §1.6, §1.11, §4.1–§4.5; Package 3).
//
// Package 3's exit evidence: "Save, resume, exit, and support-failure scenarios
// pass. Member boundary and safety gates unchanged. Moderated task completion
// passes."
//
// THREE OF THOSE ARE MACHINE-CHECKABLE AND THEY ARE THE THREE THAT ROT.
//
//   SAVE. The word "Saved" must be unreachable except from a confirmed server
//   result. §4.4: "Replace blanket claims such as Your answers are saved with
//   confirmed state." The failure here is silent and total — a person believes
//   their answers are on file and they are not — so the test does not check
//   that the current code is careful. It checks that there is no constructor
//   that produces `saved` without a CommandResult.
//
//   RESUME. Resume must be impossible to offer from browser state alone,
//   because the thing that may have changed while somebody was away is not only
//   whether their answers landed. It is whether today's gate still permits the
//   activity. So the test passes a local record with NO server answer and
//   asserts the result is "go and ask", never "resume".
//
//   EXIT AND SUPPORT. §1.6's three controls, and §1's rule that grounding and
//   crisis survive every failure. The test walks all seven states and asserts
//   both paths are in every one — including `open`, where it is easiest to
//   argue they are unnecessary and therefore easiest to drop.
//
// AND THE MEMBER BOUNDARY IS CHECKED ON THE REAL PROJECTION, not on a fixture
// shaped like one. Package 1 built the allow-list; this is the first package
// whose projection goes through it, so the guard renders every one of the seven
// states and asserts each survives `assertMemberProjection`.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  DAY_STATES, DAY_STATE_COPY, DAY_STATE_LABEL, DAY_STATE_MESSAGE,
  REQUIRED_PATHS, GATE_STATES,
  memberDayView, requiredPaths, alwaysReachable, pathsBesidesDock,
  type DayState,
} from "../src/lib/experience/member-day";
import {
  ACTIVITY_EXITS, EXIT_LABEL, EXIT_NOTE, EXIT_NOTE_UNCOMMITTED, ENDS_ACTIVITY,
  SAVE_STATES, SAVE_LABEL, saveState, mayClaimSaved, unsaved, saving,
  activityShell, ActivityShellError,
  resumeDecision, localRunsAhead, mayPersistLocally,
  LOCAL_STORAGE_ALLOWED_KEYS, DOCK_RESERVE_PX, NARROW_VIEWPORT_PX,
} from "../src/lib/experience/activity-shell";
import {
  confirmed, rejected, stale, unavailable, indeterminate,
} from "../src/lib/experience/command";
import { violations } from "../src/lib/experience/member-projection";
import { SUPPORT_ENTRIES } from "../src/lib/experience/support-dock";
import {
  ALL_EXPERIENCE_FLAGS, experienceFlagEnabled, memberShellEnabled,
} from "../src/lib/experience/flags";
import type { MemberDay } from "../src/lib/member/view";

const SRC = path.join(__dirname, "..", "src");
const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");

function gateDay(shape: MemberDay["shape"], practices = 2): MemberDay {
  const all = Array.from({ length: practices }, (_, i) => ({
    id: `practice-${i}`,
    name: `Practice ${i}`,
    minutes: 6 + i,
  }));
  return {
    shape,
    practices: all,
    primary: all[0] ?? null,
    messageKey: DAY_STATE_COPY[shape],
    humanSupport: true,
  };
}

const NOW = "2026-09-09T08:00:00.000Z";

// ---------------------------------------------------------------------------
// §1.11 — seven states, not five
// ---------------------------------------------------------------------------

test("the day has the seven states §1.11 ruled for, and the two extra ones are not gate outcomes", () => {
  assert.equal(DAY_STATES.length, 7);
  for (const extra of ["interrupted", "service_unavailable"] as const) {
    assert.ok(DAY_STATES.includes(extra), `${extra} is missing`);
    assert.ok(
      !(GATE_STATES as readonly string[]).includes(extra),
      `${extra} is listed as a gate outcome — the gate answers "what may this person do", ` +
        `and this answers "what happened to this person's session"`
    );
  }
  // And the five the gate does produce are all still here. §1.11 ADDED two; it
  // did not replace the model.
  for (const shape of GATE_STATES) {
    assert.ok((DAY_STATES as readonly string[]).includes(shape), `${shape} was dropped`);
  }
});

test("every state has a copy key, a label and a rendered sentence", () => {
  for (const state of DAY_STATES) {
    const key = DAY_STATE_COPY[state];
    assert.ok(/^day\.[a-z_]+\.v\d+$/.test(key), `${state} has copy key "${key}"`);
    assert.ok(DAY_STATE_LABEL[state]?.length > 0, `${state} has no label`);
    assert.ok(DAY_STATE_MESSAGE[key]?.length > 0, `${key} renders nothing`);
  }
});

test("no state's copy explains why the day is narrow", () => {
  // §2: "If narrowing reads as 'you failed the check', you produce shame in a
  // population where shame drives disengagement." So no sentence a member reads
  // may name a score, a rule, a threshold or a failure.
  const banned = /score|band|severity|threshold|rule|risk|failed|criteria|elevated|flag/i;
  for (const state of DAY_STATES) {
    const sentence = DAY_STATE_MESSAGE[DAY_STATE_COPY[state]];
    assert.ok(!banned.test(sentence), `${state}: "${sentence}"`);
    assert.ok(!banned.test(DAY_STATE_LABEL[state]), `${state} label: "${DAY_STATE_LABEL[state]}"`);
  }
});

test("service_unavailable does not read as an empty day", () => {
  // The distinction §1.11 exists for. "There is nothing for you today" and
  // "Steady cannot load your day" are different sentences, and only one of them
  // is true when a read fails.
  const s = DAY_STATE_MESSAGE["day.service_unavailable.v1"];
  assert.match(s, /cannot load/i);
  assert.ok(!/nothing (for you|to do)/i.test(s), `reads as an empty day: "${s}"`);
  // And it says support does not depend on the thing that failed.
  assert.match(s, /grounding and support/i);
});

test("the interrupted sentence does not claim anything was saved", () => {
  // §4.4: the server has not been asked at the point this sentence is written.
  // "Your answers are saved" is the exact claim the handoff names.
  const s = DAY_STATE_MESSAGE["day.interrupted.v1"];
  assert.ok(!/saved|stored|kept safe/i.test(s), `claims a save: "${s}"`);
});

// ---------------------------------------------------------------------------
// §4.2 — required paths
// ---------------------------------------------------------------------------

test("grounding and crisis are in every state's required paths, including open", () => {
  // §1: "grounding and crisis resources remain reachable even when a write,
  // subscription, sync, or service fails." `open` is the one where it is
  // easiest to argue they are redundant, which is why it is checked by name.
  for (const state of DAY_STATES) {
    assert.ok(alwaysReachable(state), `${state} can be rendered without grounding or crisis`);
    const hrefs = requiredPaths(state).map((p) => p.href);
    assert.ok(hrefs.includes("/app/ground"), `${state} has no grounding path`);
    assert.ok(hrefs.includes("/crisis"), `${state} has no crisis path`);
  }
  assert.ok(alwaysReachable("open"));
});

test("no support route is drawn twice on one member screen", () => {
  // FOUND BY LOOKING AT A 390px SCREENSHOT. Today rendered "Ground now" and
  // "Talk to someone" as pills about a hundred pixels above the fixed dock
  // rendering the same two labels, so a member had to decide whether the two
  // were the same button on a screen whose whole job is removing decisions.
  const dockHrefs = SUPPORT_ENTRIES.map((e) => e.href);
  for (const state of DAY_STATES) {
    const drawn = pathsBesidesDock(state, dockHrefs).map((p) => p.href);
    for (const href of drawn) {
      assert.ok(!dockHrefs.includes(href), `${state} draws ${href} and so does the dock`);
    }
    // AND NOTHING IS LOST. The union has to cover §4.2's list, or deduplicating
    // has quietly dropped a path the state is required to offer.
    const union = new Set([...drawn, ...dockHrefs]);
    for (const p of requiredPaths(state)) {
      assert.ok(union.has(p.href), `${state} no longer offers ${p.href} anywhere`);
    }
  }
  // On a crisis day the required paths ARE the dock's, so the row is empty and
  // the surface renders nothing rather than an empty heading.
  assert.equal(pathsBesidesDock("crisis", dockHrefs).length, 0);
  const view = read("components/experience/MemberTodayView.tsx");
  assert.match(view, /paths\.length > 0 &&/, "an empty path row still renders its heading");
  // AND THE SURFACE HAS TO ACTUALLY PASS THE DOCK'S ROUTES. `pathsBesidesDock`
  // with an empty list is the same as no deduplication at all, and it
  // type-checks — so the call site is checked, not just the function.
  assert.match(
    view,
    /pathsBesidesDock\(\s*day\.state,\s*SUPPORT_ENTRIES\.map\(\(e\) => e\.href\)\s*\)/,
    "the view does not pass the dock's routes, so nothing is deduplicated"
  );
});

test("no state offers a path to the screen the member is already on", () => {
  // Today rendered a pill linking to Today. §4.2 gives a Today path to the two
  // states reached from inside an activity, where getting back out is the
  // point; the ordinary day is already out.
  assert.ok(
    !REQUIRED_PATHS.open.some((p) => p.href === "/app/today"),
    "an open day offers a link to the page it is on"
  );
  for (const state of ["interrupted", "service_unavailable"] as const) {
    assert.ok(
      REQUIRED_PATHS[state].some((p) => p.href === "/app/today"),
      `${state} has no way back out to Today`
    );
  }
});

test("a member never reads a raw timestamp", () => {
  // The same defect as the clinician load panel's ISO timestamps, found the
  // same way. "2026-09-01" is a value; a date is a day somebody remembers.
  const src = read("components/experience/MemberTodayView.tsx");
  assert.ok(
    !/[^$]\{r\.occurredAt\}/.test(src),
    "recent activity renders occurredAt directly, so a member reads a database value"
  );
  assert.match(src, /onDay\(r\.occurredAt\)/);
  assert.match(src, /toLocaleDateString/);
});

test("the member navigation row scrolls rather than breaking a destination in half", () => {
  // At 390px a four-destination row broke "Care team" across two lines
  // mid-phrase, which reads as two items. §1.1: a navigation item is a promise.
  const src = read("components/experience/MemberShell.tsx");
  assert.match(src, /overflow-x-auto/);
  assert.match(src, /whitespace-nowrap/);
  assert.ok(!/flex flex-wrap[^"]*"[\s\S]{0,200}navigation\.core/.test(src));
});

test("a crisis day leads with support", () => {
  // §4.2's crisis row. The order is the render order, and on the one screen
  // where somebody may read exactly one thing, that thing is the support path.
  assert.equal(REQUIRED_PATHS.crisis[0].href, "/crisis");
});

test("a crisis day offers no processing activity", () => {
  const view = memberDayView({ day: gateDay("crisis"), now: NOW });
  assert.equal(view.state, "crisis");
  assert.equal(view.recommended, null, "a crisis day recommended an activity");
});

test("a paused day names a way back through a person", () => {
  // §4.2: "State that processing is paused and name the safe next step." A
  // paused day whose only paths are grounding and crisis tells somebody facing
  // weeks of exclusion that there is nothing else.
  const hrefs = REQUIRED_PATHS.paused.map((p) => p.href);
  assert.ok(hrefs.some((h) => h === "/app/care-team"), `paused offers only: ${hrefs.join(", ")}`);
});

// ---------------------------------------------------------------------------
// §4.1 — the hierarchy
// ---------------------------------------------------------------------------

test("the day carries one orienting sentence and at most one recommendation", () => {
  const view = memberDayView({ day: gateDay("open", 5), now: NOW });
  assert.equal(typeof view.orientingSentence, "string");
  assert.ok(!Array.isArray(view.recommended), "recommended is a list, so Today has more than one primary");
  // §4.1: "what it is, an approximate duration, and a clear pause promise."
  assert.ok(view.recommended);
  assert.equal(typeof view.recommended!.approximateMinutes, "number");
  assert.ok(view.recommended!.pausePromise.length > 0);
});

test("the pause promise is on every recommendation, not only the long ones", () => {
  // The reason somebody needs the promise is the reason they might not start.
  for (const shape of ["open", "narrow", "stabilizing"] as const) {
    const view = memberDayView({ day: gateDay(shape), now: NOW });
    assert.ok(view.recommended, `${shape} recommended nothing`);
    assert.match(view.recommended!.pausePromise, /stop/i, `${shape}: no pause promise`);
  }
});

test("the recommended activity is never repeated among the secondary tools", () => {
  const view = memberDayView({ day: gateDay("open", 5), now: NOW });
  assert.ok(view.recommended);
  assert.ok(
    !view.tools.some((t) => t.href === view.recommended!.startHref),
    "the primary card is also in the list below it, so the member is shown two of the same thing"
  );
});

test("recent activity carries no run, no count and no percentage", () => {
  const view = memberDayView({
    day: gateDay("open"),
    recent: Array.from({ length: 9 }, (_, i) => ({ kind: "Check-in", occurredAt: `2026-09-0${i + 1}` })),
    now: NOW,
  });
  // §4.1: "No streaks, no missed-day penalties, no progress percentages, no
  // withheld-card counts." Bounded, so the length of the list is not itself a
  // volume statement.
  assert.ok(view.recent.length <= 3, `recent had ${view.recent.length} items`);
  for (const key of Object.keys(view.recent[0])) {
    assert.ok(!/count|total|streak|percent|days/i.test(key), `recent item carries "${key}"`);
  }
});

// ---------------------------------------------------------------------------
// The member boundary, on the real projection
// ---------------------------------------------------------------------------

test("every one of the seven states survives the member allow-list", () => {
  // Package 1 built the allow-list against fixtures. This is the first real
  // projection to cross it, and it crosses in all seven shapes — because a
  // boundary that only holds on the happy path is a boundary that leaks on the
  // day something goes wrong.
  for (const shape of GATE_STATES) {
    const view = memberDayView({ day: gateDay(shape), now: NOW });
    assert.deepEqual(violations(view, "day"), [], `${shape} leaked a field`);
  }
  const interrupted = memberDayView({
    day: gateDay("open"),
    interrupted: { activityId: "m1", title: "Processing", resumeHref: "/app/session/m1" },
    now: NOW,
  });
  assert.deepEqual(violations(interrupted, "day"), []);
  const down = memberDayView({ day: null, now: NOW });
  assert.deepEqual(violations(down, "day"), []);
});

test("a score attached to the gate's day does not reach the member view", () => {
  // The failure the allow-list exists for: not a field called `severity_band`,
  // but a field somebody adds with a tidy short name.
  const poisoned = {
    ...gateDay("open"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  poisoned.primary = { ...poisoned.primary, severity: 4, t: 52 };
  const view = memberDayView({ day: poisoned, now: NOW });
  assert.deepEqual(violations(view, "day"), [], "the projection copied a foreign field through");
  assert.ok(!JSON.stringify(view).includes('"severity"'));
});

// ---------------------------------------------------------------------------
// deriveState's order is a safety order
// ---------------------------------------------------------------------------

test("an unreadable day is service_unavailable whatever else was true", () => {
  const view = memberDayView({
    day: null,
    interrupted: { activityId: "m1", title: "Processing", resumeHref: "/x" },
    now: NOW,
  });
  assert.equal(view.state, "service_unavailable");
});

test("a crisis day outranks an interruption", () => {
  // Somebody part-way through a check-in on a crisis day needs support, not a
  // resume prompt.
  const view = memberDayView({
    day: gateDay("crisis"),
    interrupted: { activityId: "m1", title: "Processing", resumeHref: "/x" },
    now: NOW,
  });
  assert.equal(view.state, "crisis");
  assert.equal(view.recommended, null);
});

test("an interruption on an ordinary day leads with picking it back up", () => {
  const view = memberDayView({
    day: gateDay("open"),
    interrupted: { activityId: "m1", title: "Processing", resumeHref: "/app/session/m1" },
    now: NOW,
  });
  assert.equal(view.state, "interrupted");
  assert.equal(view.recommended?.startHref, "/app/session/m1");
  assert.ok(
    !/saved/i.test(view.recommended!.description),
    `claims a save before the server was asked: "${view.recommended!.description}"`
  );
});

// ---------------------------------------------------------------------------
// §1.6 — the active-session shell
// ---------------------------------------------------------------------------

test("the shell carries §1.6's three controls, always all three", () => {
  const shell = activityShell({
    activityId: "ground",
    title: "Come back to the room",
    step: { index: 1, total: 5, instruction: "One step at a time." },
  });
  assert.deepEqual(shell.exits.map((e) => e.exit), [...ACTIVITY_EXITS]);
  assert.deepEqual([...ACTIVITY_EXITS], ["pause", "stop", "support"]);
  for (const e of shell.exits) {
    assert.ok(e.label.length > 0 && e.note.length > 0, `${e.exit} has no label or note`);
  }
});

test("only Stop ends the activity", () => {
  // §4: "Pause preserves permitted progress; Stop follows the existing exit and
  // closure rules." A person who grounds mid-session has not abandoned it.
  assert.equal(ENDS_ACTIVITY.pause, false);
  assert.equal(ENDS_ACTIVITY.stop, true);
  assert.equal(ENDS_ACTIVITY.support, false);
});

test("routine navigation cannot be turned back on during an activity", () => {
  const shell = activityShell({
    activityId: "m1",
    title: "Processing",
    step: { index: 2, total: 8, instruction: "Notice what comes up." },
  });
  assert.equal(shell.routineNavigationVisible, false);
  // And the shape has no field a nav could arrive in.
  assert.ok(
    !Object.keys(shell).some((k) => /nav|sidebar|menu|destinations/i.test(k) && k !== "routineNavigationVisible"),
    `the shell has a navigation field: ${Object.keys(shell).join(", ")}`
  );
});

test("the activity shell component imports no navigation", () => {
  // §1.6 as a property of the module graph rather than of the current render.
  // A `showNav` prop defaulting to false is a prop somebody passes true to.
  const src = read("components/experience/ActivityShell.tsx");
  assert.ok(
    !/from "@\/lib\/experience\/navigation"/.test(src),
    "ActivityShell imports the navigation manifest, so a sidebar can be drawn over a session"
  );
  assert.ok(!/NavigationManifest/.test(src));
});

test("Pause only promises to keep a place when there is a place to keep", () => {
  // §4.5: a claim on a member surface must be true when it is read. Grounding
  // holds no server state, so "keeps your place" is false on it.
  const stateless = activityShell({
    activityId: "ground", title: "Ground",
    step: { index: 1, total: 5, instruction: "x" },
  });
  const committing = activityShell({
    activityId: "m1", title: "Processing", commitsProgress: true,
    step: { index: 1, total: 5, instruction: "x" },
  });
  const pauseOf = (s: ReturnType<typeof activityShell>) =>
    s.exits.find((e) => e.exit === "pause")!.note;
  assert.ok(!/keeps your place/i.test(pauseOf(stateless)), `stateless: "${pauseOf(stateless)}"`);
  assert.match(pauseOf(committing), /keeps your place/i);
  // But the CONTROL is there either way. §1.6 lists three.
  assert.equal(stateless.exits.length, 3);
  assert.equal(EXIT_NOTE_UNCOMMITTED.stop, EXIT_NOTE.stop, "only Pause's wording is conditional");
  assert.equal(EXIT_NOTE_UNCOMMITTED.support, EXIT_NOTE.support);
  assert.equal(EXIT_LABEL.pause, "Pause");
});

test("a step that would render as 'step 0 of 6' is refused", () => {
  assert.throws(
    () => activityShell({ activityId: "m", title: "t", step: { index: 0, total: 6, instruction: "x" } }),
    ActivityShellError
  );
  assert.throws(
    () => activityShell({ activityId: "m", title: "t", step: { index: 7, total: 6, instruction: "x" } }),
    ActivityShellError
  );
  // An open-ended activity is fine — `total: null` renders as "Step 2".
  assert.doesNotThrow(
    () => activityShell({ activityId: "m", title: "t", step: { index: 2, total: null, instruction: "x" } })
  );
});

test("the fixed dock reserves its own space at 320 CSS pixels", () => {
  // §1.6: "No fixed element may obscure a focused control at 320 CSS pixels."
  //
  // THE RESERVE IS ON THE BODY, NOT IN THE COMPONENT, and the reason is a bug a
  // screenshot found: a spacer inside the dock protects the page, and the root
  // layout renders the site footer AFTER the page — so the 988 notice at the
  // end of every member screen went under the bar anyway.
  assert.equal(NARROW_VIEWPORT_PX, 320);
  assert.ok(DOCK_RESERVE_PX > 0);
  assert.match(read("components/experience/SupportDock.tsx"), /data-support-dock=""/);

  const css = fs.readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
  const reserve = css.match(/body:has\(\[data-support-dock\]\)\s*\{\s*padding-bottom:\s*(\d+)px/);
  assert.ok(reserve, "globals.css reserves no space for the dock");
  assert.equal(
    Number(reserve![1]), DOCK_RESERVE_PX,
    "the CSS reserve and DOCK_RESERVE_PX disagree, so one of them is wrong and neither says which"
  );
});

test("the two fixed member support controls do not overlap", () => {
  // FOUND BY LOOKING AT A 320px SCREENSHOT, not by a type error. The SOS panic
  // button predates the dock and is fixed to the same corner; stacked with no
  // coordination it sat squarely on top of the dock's third entry.
  //
  // Both halves are asserted, because either one alone silently restores the
  // overlap: the attribute on the button, and the rule that lifts it.
  assert.match(read("components/SosButton.tsx"), /data-sos-button=""/);
  const css = fs.readFileSync(path.join(SRC, "app", "globals.css"), "utf8");
  const lift = css.match(
    /body:has\(\[data-support-dock\]\)\s*\[data-sos-button\]\s*\{\s*bottom:\s*calc\((\d+)px/
  );
  assert.ok(lift, "nothing lifts the SOS button clear of the dock");
  assert.ok(
    Number(lift![1]) >= DOCK_RESERVE_PX,
    `the SOS button is lifted ${lift![1]}px over a ${DOCK_RESERVE_PX}px dock`
  );
  // And the lift is scoped to screens that mount a dock, so the button is
  // unchanged on every other member screen.
  assert.ok(!/^\s*\[data-sos-button\]\s*\{/m.test(css), "the lift applies where there is no dock");
});

test("the dock has no prop that could hide it", () => {
  // §9: "Support must never depend on payment or module state."
  const src = read("components/experience/SupportDock.tsx");
  const props = src.match(/export function SupportDock\(\{([^}]*)\}/)?.[1] ?? "";
  const names = props.split(",").map((p) => p.trim()).filter(Boolean);
  assert.deepEqual(names, ["during"], `SupportDock takes: ${names.join(", ")}`);
  assert.ok(!/\btier\b|\bsubscri|\benabled\b|\bshow\b|\bgate/i.test(props));
});

// ---------------------------------------------------------------------------
// §4.4 — saving
// ---------------------------------------------------------------------------

test('"Saved" is reachable only from a confirmed server result', () => {
  assert.equal(saveState(confirmed({})).name, "saved");
  for (const result of [
    rejected("no"),
    stale("changed", "v2"),
    unavailable("down"),
    indeterminate("timeout", "key-1"),
  ]) {
    const s = saveState(result);
    assert.equal(s.name, "could_not_save", `${result.outcome} produced ${s.name}`);
    assert.ok(!mayClaimSaved(s));
  }
  // And there is no other way in. `unsaved` and `saving` are the only other
  // constructors, and neither can reach `saved`.
  assert.equal(unsaved().name, "unsaved");
  assert.equal(saving().name, "saving");
  const src = read("lib/experience/activity-shell.ts");
  assert.ok(
    !/export function saved\s*\(/.test(src),
    "there is a saved() constructor, so a component can congratulate itself"
  );
  assert.deepEqual([...SAVE_STATES], ["unsaved", "saving", "saved", "could_not_save"]);
  assert.equal(SAVE_LABEL.saved, "Saved");
});

test("a failure never asks the member to diagnose the network", () => {
  // §4.4: "Explain a failure without making the member diagnose connectivity."
  for (const result of [unavailable("down"), indeterminate("timeout", "k"), stale("x", "v2"), rejected("no reason")]) {
    const detail = saveState(result).detail ?? "";
    assert.ok(
      !/connection|connectivity|offline|wifi|wi-fi|network|signal/i.test(detail),
      `${result.outcome}: "${detail}"`
    );
  }
});

test("an indeterminate save offers no plain retry and names a reconcile key", () => {
  // The one case a member cannot reason about: pressing again might write
  // twice. So the retry is withheld and the key that collapses a duplicate is
  // carried instead.
  const s = saveState(indeterminate("timed out", "key-9"));
  assert.equal(s.retryable, false);
  assert.equal(s.reconcileBy, "key-9");
});

test("a refusal is not offered as a retry", () => {
  // Pressing again produces the same refusal, and a retry button says otherwise.
  assert.equal(saveState(rejected("Not permitted today.")).retryable, false);
  assert.equal(saveState(stale("changed", "v2")).retryable, false);
});

// ---------------------------------------------------------------------------
// §4.4 — resume
// ---------------------------------------------------------------------------

test("resume cannot be offered from browser state alone", () => {
  const offer = resumeDecision({ local: { activityId: "m1", step: 4 }, server: null });
  assert.equal(offer.decision, "ask_server");
  assert.equal(offer.label, "", "an unasked surface rendered an offer");
  assert.equal(offer.resumeToStep, null);
});

test("a gate that closed while somebody was away does not offer a resume", () => {
  // The safety half of §4.4: "A prior answer or permission may no longer be
  // valid." Resuming here would put somebody back into a processing session
  // today's gate has closed.
  const offer = resumeDecision({
    local: { activityId: "m1", step: 4 },
    server: { activityId: "m1", committedStep: 4, stillPermitted: false },
  });
  assert.equal(offer.decision, "start_over");
  assert.equal(offer.resumeToStep, null);
  // And it does not read as a punishment. §2.
  assert.ok(!/cannot|not allowed|denied|blocked|failed/i.test(offer.note), offer.note);
  assert.match(offer.note, /nothing you did was lost/i);
});

test("a resume names the step the server holds, not the one the browser remembers", () => {
  const offer = resumeDecision({
    local: { activityId: "m1", step: 6 },
    server: { activityId: "m1", committedStep: 4, stillPermitted: true },
  });
  assert.equal(offer.decision, "resume");
  assert.equal(offer.resumeToStep, 4, "resumed to the browser's step");
  assert.match(offer.note, /step 4/);
  assert.ok(localRunsAhead({ step: 6 }, { committedStep: 4 }));
  assert.ok(!localRunsAhead({ step: 4 }, { committedStep: 4 }));
});

test("a session that committed nothing is not something to come back to", () => {
  const offer = resumeDecision({
    local: { activityId: "m1", step: 3 },
    server: { activityId: "m1", committedStep: 0, stillPermitted: true },
  });
  assert.equal(offer.decision, "no_activity");
});

test("the resume prompt renders nothing until the server has answered", () => {
  const src = read("components/experience/ResumePrompt.tsx");
  assert.ok(
    /decision === "ask_server"[\s\S]{0,40}return null|"ask_server"\)\s*return null/.test(src),
    "ResumePrompt draws something for ask_server, which is a promise it has not checked"
  );
});

// ---------------------------------------------------------------------------
// §4.4 — what may be written to the browser
// ---------------------------------------------------------------------------

test("a resume marker may hold four keys and nothing else", () => {
  assert.deepEqual([...LOCAL_STORAGE_ALLOWED_KEYS], ["activityId", "step", "startedAt", "reconcileBy"]);
  assert.ok(mayPersistLocally({ activityId: "m1", step: 3, startedAt: NOW, reconcileBy: "k" }).ok);
  assert.ok(mayPersistLocally({ activityId: "m1", step: 3 }).ok);

  // A field the member projection allows is still not a resume marker key.
  // The two lists overlap and are not the same list: `tools` is fine to render
  // and has no business surviving in a browser after sign-out.
  const wider = mayPersistLocally({ activityId: "m1", step: 3, tools: [], recent: [] });
  assert.equal(wider.ok, false, "the key allow-list is not being applied");
  assert.ok(wider.reasons.some((r) => r.includes("tools")), wider.reasons.join(" | "));
});

test("no clinical text reaches browser storage", () => {
  // The real failure is not somebody storing a field called `sudsScore`. It is
  // somebody storing the whole draft "just to be safe" and shipping a member's
  // narrative into a place that survives sign-out on a shared phone.
  const draft = mayPersistLocally({
    activityId: "m1",
    step: 3,
    narrative: "what happened when I was nine",
  });
  assert.equal(draft.ok, false);
  assert.ok(draft.reasons.some((r) => r.includes("narrative")), draft.reasons.join(" | "));

  const scored = mayPersistLocally({ activityId: "m1", step: 3, severity: 4 });
  assert.equal(scored.ok, false);

  // AND AT ANY DEPTH. The key allow-list only reads the top level, so a value
  // wrapped inside an allowed key is caught by the recursive walk or by nothing
  // — which is the shape the leak actually arrives in when a marker key later
  // holds structure rather than a string.
  const nested = mayPersistLocally({ activityId: "m1", step: 3, reconcileBy: { severity: 4 } });
  assert.equal(nested.ok, false, "a forbidden field nested inside an allowed key was accepted");
  assert.ok(nested.reasons.some((r) => /severity/.test(r)), nested.reasons.join(" | "));

  // And a non-object is not a marker.
  assert.equal(mayPersistLocally("m1:3").ok, false);
  assert.equal(mayPersistLocally(null).ok, false);
  assert.equal(mayPersistLocally([{ activityId: "m1" }]).ok, false);
});

// ---------------------------------------------------------------------------
// §10.1 — the flag, and the experience unchanged with it off
// ---------------------------------------------------------------------------

test("the member shell flag is declared, demo-enabled, and overridable both ways", () => {
  assert.ok(ALL_EXPERIENCE_FLAGS.includes("EXPERIENCE_MEMBER_SHELL"));
  const prevDemo = process.env.EMDR_DEMO;
  const prevFlag = process.env.EMDR_EXPERIENCE_MEMBER_SHELL;
  try {
    delete process.env.EMDR_EXPERIENCE_MEMBER_SHELL;
    process.env.EMDR_DEMO = "1";
    assert.equal(memberShellEnabled(), true, "Package 3 landed and the demo does not show it");
    // A reviewer must be able to see the OLD experience in a demo environment,
    // which is how §10.1's "prove the current experience is unchanged with each
    // flag off" gets checked by a person rather than only by a test.
    process.env.EMDR_EXPERIENCE_MEMBER_SHELL = "0";
    assert.equal(memberShellEnabled(), false);
    process.env.EMDR_DEMO = "0";
    process.env.EMDR_EXPERIENCE_MEMBER_SHELL = "1";
    assert.equal(memberShellEnabled(), true);
    delete process.env.EMDR_EXPERIENCE_MEMBER_SHELL;
    assert.equal(experienceFlagEnabled("EXPERIENCE_MEMBER_SHELL"), false);
  } finally {
    if (prevDemo === undefined) delete process.env.EMDR_DEMO;
    else process.env.EMDR_DEMO = prevDemo;
    if (prevFlag === undefined) delete process.env.EMDR_EXPERIENCE_MEMBER_SHELL;
    else process.env.EMDR_EXPERIENCE_MEMBER_SHELL = prevFlag;
  }
});

test("the flag is a whole-page branch, taken before the old page reads anything", () => {
  // §10.1: "prove the current experience is unchanged with each flag off." The
  // way to make that a property rather than a claim is for the new branch to
  // return before a single line of the old one runs.
  const src = read("app/app/today/page.tsx");
  const branch = src.indexOf("if (memberShellEnabled())");
  assert.ok(branch > 0, "the Today page does not branch on the flag");
  const oldPageStart = src.indexOf("const c = await data();");
  assert.ok(oldPageStart > branch, "the old page's reads happen before the branch");
});

test("grounding does not depend on the flag to render", () => {
  // §1: "grounding and crisis resources remain reachable even when a write,
  // subscription, sync, or service fails." A grounding page that renders only
  // one way behind a feature flag has made support conditional on a deploy.
  const src = read("app/app/ground/page.tsx");
  assert.ok(/memberShellEnabled\(\)/.test(src));
  // Both branches render the same steps from one array, so they cannot drift.
  assert.equal((src.match(/steps\.map\(/g) ?? []).length, 2, "the two branches list the steps separately");
  assert.equal((src.match(/Feel your feet on the floor/g) ?? []).length, 1);
  // And neither branch is a redirect or a null. The first statement inside the
  // flag branch has to be the render — a page that returns nothing when the
  // flag is on has made grounding conditional on a deploy, which is the exact
  // thing this test exists to stop.
  const branch = src.slice(src.indexOf("if (memberShellEnabled())"));
  const firstStatement = branch.slice(branch.indexOf("{") + 1).trim().split("\n")[0].trim();
  assert.match(firstStatement, /^return \($/, `the flag branch begins with: ${firstStatement}`);
  assert.ok(!/redirect\(/.test(branch.slice(0, branch.indexOf("</ActivityShell>"))));
});

// ---------------------------------------------------------------------------
// The layer's own rules still hold
// ---------------------------------------------------------------------------

test("Package 3's modules carry no SQL into the experience layer", () => {
  // Package 1's exit evidence, re-checked on the two new pure modules. The
  // server-side reader lives in src/lib/member/day-read.ts and is allowed to query;
  // the modules a client component imports are not.
  for (const file of ["lib/experience/member-day.ts", "lib/experience/activity-shell.ts"]) {
    const src = read(file);
    assert.ok(
      !/\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bFROM\s+[a-z_]+\b/.test(src.replace(/\/\/.*$/gm, "")),
      `${file} contains SQL`
    );
  }
});

test("the pure day module pulls no database into the browser bundle", () => {
  // The mistake this codebase has made five times: a client component imports a
  // vocabulary module, the vocabulary module imports a store, and better-sqlite3
  // lands in the browser bundle.
  for (const file of ["lib/experience/member-day.ts", "lib/experience/activity-shell.ts"]) {
    const src = read(file);
    // Every specifier, including a bare side-effect import — `import "../db"`
    // has no `from` clause and pulls the driver in exactly the same way.
    const imports = [
      ...[...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/^import "([^"]+)"/gm)].map((m) => m[1]),
      ...[...src.matchAll(/require\("([^"]+)"\)|import\("([^"]+)"\)/g)].map((m) => m[1] ?? m[2]),
    ];
    for (const imp of imports) {
      assert.ok(
        !/\/(db|data|gating|repo)$/.test(imp) && !imp.includes("better-sqlite3"),
        `${file} imports ${imp}`
      );
    }
  }
});

test("no member surface in Package 3 renders a section number", () => {
  // A pre-existing rule this codebase has broken twice: "§4" is an internal
  // reference and a member reading it learns nothing.
  for (const file of [
    "components/experience/MemberTodayView.tsx",
    "components/experience/ActivityShell.tsx",
    "components/experience/SupportDock.tsx",
    "components/experience/MemberShell.tsx",
    "components/experience/ResumePrompt.tsx",
  ]) {
    const visible = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    assert.ok(!/§/.test(visible), `${file} renders a section mark to a member`);
  }
});

test("the member shell renders the dock exactly once and does not double the support link", () => {
  const src = read("components/experience/MemberShell.tsx");
  assert.equal((src.match(/<SupportDock/g) ?? []).length, 1);
  // "Get support" is in the manifest's utility row AND in the dock. Rendering
  // both in one viewport makes the fixed one look optional.
  assert.match(src, /d\.href !== "\/app\/ground"/);
});

test("every day state is rendered by something reachable", () => {
  // The standing constraint on this project: work that is not on the site is
  // not done. `memberDayView` is what /app/today renders, and the seven states
  // are the seven it can produce.
  const src = read("app/app/today/page.tsx");
  assert.match(src, /MemberTodayView/);
  assert.match(src, /readMemberDay/);
  const states = new Set<DayState>();
  for (const shape of GATE_STATES) states.add(memberDayView({ day: gateDay(shape), now: NOW }).state);
  states.add(memberDayView({ day: null, now: NOW }).state);
  states.add(memberDayView({
    day: gateDay("open"),
    interrupted: { activityId: "m", title: "t", resumeHref: "/x" },
    now: NOW,
  }).state);
  assert.equal(states.size, DAY_STATES.length, `unreachable states: ${
    DAY_STATES.filter((s) => !states.has(s)).join(", ")
  }`);
});
