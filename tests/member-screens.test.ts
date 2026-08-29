// The member screen atlas (Web GUI handoff §26, §20.2, §30.7).
//
// §26 gives the member 15 screens, each with a route, a user question and one
// primary action, and a role-level acceptance list:
//
//   "No page presents more than one dominant action."
//   "Pause, stop, grounding and support remain reachable where session activity
//    appears."
//   "No score is presented as diagnosis, readiness or proof of improvement."
//
// This holds the atlas itself — every route exists and is reachable — plus the
// two acceptance rules that are checkable from source. The third is enforced by
// member-boundary.test.ts and by assertPatternOnly.
//
// The reason the route list is a test rather than a checklist: a screen nothing
// links to is not a screen, and the last time this repository had unreachable
// surfaces (the trajectory four hops deep, /settings with no index) they were
// found by a reviewer failing to find them rather than by a build failing.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { buildGateView, assertGateSafe, GateViewError } from "../src/lib/member/gate-view";
import { hasData } from "../src/lib/presentation/envelope";

const APP = path.join(process.cwd(), "src", "app", "app");
const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

/** §26's member atlas. Sub-routes of an existing screen are not listed
 *  separately; these are the addresses §26 names. */
const ATLAS: Array<[string, string]> = [
  ["welcome", "Understand scope and control"],
  ["consent", "Choose storage and care-team sharing"],
  ["screening", "Create a starting point"],
  ["today", "Know the safest next step"],
  ["check-in", "Report current state"],
  ["activities", "Choose an allowed support tool"],
  ["session/prepare", "Confirm readiness and environment"],
  ["session/[moduleId]", "Follow the current activity safely"],
  ["session/[moduleId]/safety", "Reach support and understand the stop"],
  ["session/[moduleId]/complete", "Return to baseline and plan follow-up"],
  ["progress", "See patterns with context"],
  ["plan", "Know what is active and why"],
  ["messages", "Communicate securely"],
  ["care-team", "See verified access"],
  ["settings", "Manage account and data choices"],
];

test("every §26 member screen exists", () => {
  const missing = ATLAS
    .filter(([r]) => !fs.existsSync(path.join(APP, r, "page.tsx")))
    .map(([r, q]) => `/app/${r} — "${q}"`);
  assert.deepEqual(missing, [], "these §26 member screens do not exist:\n  " + missing.join("\n  "));
});

test("every member screen is reachable without typing a URL", () => {
  // Nav, settings index, or a link from another member screen. A screen only
  // reachable by URL is one a member will never find.
  const surfaces = fs.readdirSync(APP, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => [read(path.join(APP, e.name, "page.tsx"))]);
  const linkSources = [
    read(path.join(process.cwd(), "src/components/member/MemberNav.tsx")),
    ...surfaces,
  ].join("\n");

  // session/* is entered from a session, not linked as a destination.
  const destinations = ATLAS.map(([r]) => r).filter((r) => !r.startsWith("session/"));
  const orphans = destinations.filter((r) => !linkSources.includes(`/app/${r}`));
  assert.deepEqual(orphans, [],
    "these member screens are not linked from anywhere: " + orphans.join(", ") +
    "\nAdd them to MemberNav or link them from a screen that is.");
});

test("no member screen presents more than one dominant action", () => {
  // §26's acceptance rule. The filled dark button is the dominant action in
  // this design system; two on a page is two dominant actions whatever the
  // labels say.
  const offenders: string[] = [];
  for (const [r] of ATLAS) {
    const src = read(path.join(APP, r, "page.tsx"))
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    if (!src) continue;
    // bg-ground on a Link or button is the primary treatment.
    const primaries = (src.match(/className=\{?["`][^"`]*\bbg-ground\b[^"`]*px-6 py-4/g) ?? []).length;
    if (primaries > 1) offenders.push(`/app/${r} — ${primaries} dominant actions`);
  }
  assert.deepEqual(offenders, [], "more than one dominant action:\n  " + offenders.join("\n  "));
});

// ---------------------------------------------------------------------------
// The safety gate (§30.7)
// ---------------------------------------------------------------------------

function gate(phase: "pause" | "block" | "responded" | "re_entry") {
  const e = buildGateView({ phase, ruleId: "S-04", tenantId: "t1" });
  assert.ok(hasData(e));
  return e.data!;
}

test("the gate states what did not make the decision", () => {
  // §30.7: "AI may explain a result. AI cannot make, clear, reverse or override
  // the gate." A member who believes a model stopped them will argue with it,
  // work around it, or distrust the next thing the product says.
  for (const p of ["pause", "block", "responded", "re_entry"] as const) {
    assert.match(gate(p).authorityNote, /no ai model/i, `${p} does not disclaim model authority`);
  }
  assert.throws(
    () => assertGateSafe({ ...gate("block"), authorityNote: "A rule stopped this." }),
    GateViewError
  );
});

test("the gate always offers support that needs nothing from us", () => {
  // §20.2: "Support remains reachable during offline, write failure, and
  // service failure states." Only true if the first option is a phone number.
  for (const p of ["pause", "block", "responded", "re_entry"] as const) {
    const g = gate(p);
    assert.ok(g.options.length > 0, `${p} offers no support`);
    assert.ok(g.options.some((o) => o.alwaysAvailable), `${p} has no failure-proof option`);
    assert.equal(g.options[0].href, "tel:988", `${p} does not lead with 988`);
  }
  assert.throws(() => assertGateSafe({ ...gate("block"), options: [] }), GateViewError);
  assert.throws(
    () => assertGateSafe({
      ...gate("block"),
      options: [{ id: "x", label: "x", href: "/x", alwaysAvailable: false }],
    }),
    GateViewError,
    "a gate whose support all depends on this system was accepted"
  );
});

test("a block offers no re-check, a pause does", () => {
  // §27.5: re-entry is a new fixed-rule evaluation, not a button that clears
  // history — and a block has not met the conditions for one.
  assert.equal(gate("block").recheckAvailable, false);
  assert.equal(gate("responded").recheckAvailable, false);
  assert.equal(gate("pause").recheckAvailable, true);
});

test("the gate never apologises or alarms", () => {
  // §9.1: a stop carries weight through contrast and typography, not alarm
  // colour, and copy that treats it as a failure teaches the member to
  // experience it as one.
  const src = read(path.join(APP, "session/[moduleId]/safety/page.tsx"))
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(src.length > 0, "the safety gate screen is missing");
  assert.doesNotMatch(src, /\bsorry\b|\bunfortunately\b|\bfailed\b/i, "the gate apologises");
  assert.doesNotMatch(src, /\bbg-red|text-red|border-red\b/, "the gate uses alarm colour");
  for (const p of ["pause", "block", "responded", "re_entry"] as const) {
    assert.doesNotMatch(gate(p).headline, /sorry|error|fail/i);
  }
});

// ---------------------------------------------------------------------------
// §20.2 — the check-in carries the member into the result
// ---------------------------------------------------------------------------

test("the check-in lands on the plan it just changed", () => {
  // §3.5: the result "does not reliably carry the member into the recommended
  // activity. The member must leave the result and find the right tool."
  // §20.2: it "changes the next action without requiring navigation to a
  // catalog."
  const actions = read(path.join(process.cwd(), "src/lib/actions.ts"));
  const fn = /export async function submitCheckin[\s\S]*?\n\}/.exec(actions);
  assert.ok(fn, "submitCheckin not found");
  assert.match(fn![0], /redirect\("\/app\/today\?from=checkin"\)/,
    "the check-in does not land on Today, so the result does not carry the member into it");
  // A crisis result still goes straight to support, ahead of any plan.
  assert.match(fn![0], /redirect\("\/crisis\?from=checkin"\)/,
    "a crisis check-in no longer routes directly to support");
});

test("screens with no backing capability say so rather than faking one", () => {
  // Messages has no table, no thread and no recipient. An inbox with a composer
  // and nobody to receive it invites a member to write something they need
  // someone to read, and then holds it — the notification-truth defect with a
  // text box attached.
  const src = read(path.join(APP, "messages/page.tsx"));
  assert.ok(src.length > 0, "the messages screen is missing");
  assert.doesNotMatch(src, /<textarea|type="submit"|<form/,
    "the messages screen offers a composer with no recipient");
  assert.match(src, /tel:988/, "the messages screen does not offer a way to reach a person");
});
