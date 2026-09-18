import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SafetyRestrictions } from "../src/components/clinical/SafetyRestrictions";
import {
  gateHolds, HOLDING_GATE_STATES, gateCause, type GateDecision, type GateGroup,
} from "../src/lib/clinical/gate-review";
import { BLOCKING_GATE_STATES } from "../src/lib/clinical/therapeutic-load-policy";
import { NEVER_OVERRIDABLE } from "../src/lib/clinical/review";

// UX 004: "Load links to Safety for an access hold, while Safety says no
// response is pending. Separate current restrictions from unresolved safety
// events. Acceptance: missing screening appears with its actual next step."
//
// Both screens were telling the truth about different things, under one word.
// Therapeutic Load stops when a GATE holds a module; the safety screen listed
// ALERTS. A clinician who followed the link read "nothing is awaiting a
// documented response" as a denial of the hold they had just been shown, and
// the real constraint was two screens away behind a drawer.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function decision(over: Partial<GateDecision> = {}): GateDecision {
  return {
    personId: "p1", moduleId: "m1", moduleTitle: "Processing", state: "limited",
    headline: "Limited — screening incomplete",
    memberCopy: "Please complete the program-fit questions first.",
    safeAlternative: "Grounding and regulation remain open",
    memberAction: "Complete the program-fit questions",
    reasons: [{ code: "gate.screening", label: "Program-fit screening incomplete" }],
    evidence: [], policy: { id: "module-access-gate", version: "v1" },
    effectiveAt: "2026-09-18 10:00:00", prior: null,
    overridable: null, neverOverridable: NEVER_OVERRIDABLE,
    ...over,
  } as GateDecision;
}

const group = (over: Partial<GateDecision> = {}, modules?: string[]): GateGroup => ({
  decision: decision(over),
  moduleNames: modules ?? [decision(over).moduleTitle],
});

// ---------------------------------------------------------------------------
// The acceptance condition
// ---------------------------------------------------------------------------

test("a missing screening appears with the step that actually resolves it", () => {
  const html = renderToStaticMarkup(
    <SafetyRestrictions groups={[group()]} personId="p1" policyVersion="v1" />
  );
  const body = text(html);

  assert.ok(body.includes("screening incomplete"), "the cause is not on the screen");
  assert.ok(body.includes("Next step"), "the restriction does not say there is a next step");
  assert.ok(body.includes("Complete the program-fit questions"),
    "the restriction names no step that resolves it, which is the whole acceptance condition");

  // And the alternative, because §23.4 forbids showing a gate without one.
  assert.ok(body.includes("Grounding and regulation remain open"));
});

test("the step shown is the gate's own, not a sentence this screen invented", () => {
  // A restriction whose next step is written here would drift from the one the
  // member is given, and then a clinician and a member are working from two
  // different answers about what opens the module.
  const odd = group({ memberAction: "Ring the clinic on Tuesday" });
  const body = text(renderToStaticMarkup(
    <SafetyRestrictions groups={[odd]} personId="p1" policyVersion="v1" />
  ));
  assert.ok(body.includes("Ring the clinic on Tuesday"),
    "the component substituted its own next step for the decision's");
});

// ---------------------------------------------------------------------------
// The separation
// ---------------------------------------------------------------------------

test("no restriction is a stated fact, not a blank", () => {
  const body = text(renderToStaticMarkup(
    <SafetyRestrictions groups={[]} personId="p1" policyVersion="clinical-policy-2026-08-t1" />
  ));
  assert.ok(body.includes("No restriction is in force"),
    "an empty restrictions list renders nothing, which reads as 'nothing to see'");
  assert.ok(body.includes("clinical-policy-2026-08-t1"),
    "the empty state does not say which rules it read");

  // THE DEFECT IN ONE ASSERTION. The two empty states on this screen must not
  // be the same sentence: "no restriction is in force" and "nothing is awaiting
  // a documented response" are different facts, and answering the first with
  // the second is what sent a clinician in a circle.
  assert.ok(!body.includes("awaiting a documented response"),
    "the restrictions section answers with the safety events section's sentence");
});

test("the section says what it is not, where a reader is looking", () => {
  const body = text(renderToStaticMarkup(
    <SafetyRestrictions groups={[group()]} personId="p1" policyVersion="v1" />
  ));
  assert.match(body, /not work awaiting a response/i,
    "the screen does not distinguish a restriction from an unresolved event");
  assert.match(body, /documenting one does not lift one/i,
    "the screen does not say that responding to an event leaves a restriction in place");
});

// ---------------------------------------------------------------------------
// Presentation rules that were already argued elsewhere
// ---------------------------------------------------------------------------

test("one cause holding eleven modules is one row that names them", () => {
  const eleven = group({}, [
    "Processing", "Resourcing", "Containment", "Grounding", "Body scan",
    "Future template", "Cognitive interweave", "Safe place", "Light stream",
    "Spiral", "Closure",
  ]);
  const html = renderToStaticMarkup(
    <SafetyRestrictions groups={[eleven]} personId="p1" policyVersion="v1" />
  );
  assert.equal((html.match(/<li /g) ?? []).length, 1,
    "an incomplete form is rendered as eleven problems");
  const body = text(html);
  assert.ok(body.includes("11 modules"), "the modules affected are hidden rather than named");
  assert.ok(body.includes("Closure"), "a module the restriction applies to is not listed");
});

test("the state word is not printed twice", () => {
  const body = text(renderToStaticMarkup(
    <SafetyRestrictions groups={[group()]} personId="p1" policyVersion="v1" />
  ));
  assert.ok(!body.includes("Limited Limited"), "the state stutters beside the headline");
  assert.equal(gateCause(decision()), "screening incomplete");
});

test("the decision is linked, not rendered a second time", () => {
  // The drawer on the overview shows the evidence, the prior decision, the
  // member copy and what may not be overridden. Two renderings of one decision
  // is how they come to disagree, so this section carries the state, the cause
  // and the step, and points at the rest.
  const html = renderToStaticMarkup(
    <SafetyRestrictions groups={[group()]} personId="p1" policyVersion="v1" />
  );
  assert.ok(html.includes('href="/clinician/member/p1#gates"'), "the full decision is not reachable");
  assert.ok(!text(html).includes("Please complete the program-fit questions first."),
    "the member-copy preview is duplicated out of the drawer");
});

// ---------------------------------------------------------------------------
// The two screens agree about what "held" means
// ---------------------------------------------------------------------------

test("Load stops on exactly the states the safety screen calls a restriction", () => {
  // THE STRUCTURAL FIX. The contradiction was possible because one screen's
  // notion of "held" lived in the therapeutic-load policy and the other had
  // none at all. They are one list now, and this fails if a copy reappears.
  assert.deepEqual([...BLOCKING_GATE_STATES], [...HOLDING_GATE_STATES],
    "Therapeutic Load and the safety screen disagree about which gates hold");
  for (const s of HOLDING_GATE_STATES) assert.equal(gateHolds(s), true);
  assert.equal(gateHolds("open"), false);
  assert.equal(gateHolds("caution"), false,
    "caution counts as a restriction, which would make almost every stabilization day read as one");

  const policy = code(read("src/lib/clinical/therapeutic-load-policy.ts"));
  assert.doesNotMatch(policy, /\[\s*"limited"/,
    "the load policy has its own copy of the holding states again");
});

test("the screen that reports a hold links to the section that explains it", () => {
  const load = code(read("src/app/clinician/member/[id]/load/page.tsx"));
  assert.match(load, /safety#restrictions/,
    "Therapeutic Load still sends a clinician to the top of a screen whose first answer is about something else");

  const safety = code(read("src/app/clinician/member/[id]/safety/page.tsx"));
  assert.match(safety, /gateHolds/,
    "the safety screen no longer reads the gates, so it can only report events again");
  assert.match(safety, /Unresolved safety events/,
    "the events section is named 'open gate events' again, which is the word the restriction also answers to");
});
