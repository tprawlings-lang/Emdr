import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryTrajectoryCard } from "../src/components/clinical/RecoveryTrajectoryCard";
import { trajectoryLine } from "../src/lib/clinical/recovery-trajectory";
import type { TrajectorySet } from "../src/lib/clinical/recovery-trajectory";

// Trajectory (17 September handoff, P4).
//
//   "Put findings first and technical explanation later. Descriptive status
//   cannot be mistaken for a forecast."
//
// The page put both first. The card at the top listed every domain with its
// state AND the reading it was judged on AND the reconstruction caveat — and
// then each domain's own panel, twenty lines down, printed the same sentence
// again beside the threshold and the windows. So the top of the page was a
// second copy of the bottom of it, and the one thing a reader wants at a glance
// — which domains reached which state — was buried inside its own evidence.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const HEADLINE = "Recent middle reading 4 (0–10), against 2 in the 21 days before.";

const rows = [{
  domainType: "dissociation" as const, domainKey: "dissociation", label: "Dissociation",
  state: "reversing" as const, headline: HEADLINE,
  limitations: ["6 of the 11 recent readings were reconstructed after the fact."],
}];

const set = (snapshots: Array<{ label: string; state: string }>): TrajectorySet => ({
  personId: "p1", evidenceCutoff: "2026-09-18T00:00:00.000Z",
  policyVersion: "recovery-trajectory.1.0.0", unavailable: [],
  snapshots: snapshots as never[],
});

// ---------------------------------------------------------------------------
// Findings first
// ---------------------------------------------------------------------------

test("the card can carry the finding without the reading behind it", () => {
  const t = text(renderToStaticMarkup(
    <RecoveryTrajectoryCard
      personId="p1" rows={rows} line={null} policyVersion="v" emptyNote={null}
      explanation={false}
    />
  ));
  assert.match(t, /Dissociation/, "the domain is gone, not just its explanation");
  assert.match(t, /Moving the other way/, "the state is gone");
  assert.doesNotMatch(t, /Recent middle reading/, "the technical explanation is still on the card");
  assert.doesNotMatch(t, /reconstructed after the fact/);
});

test("and it still carries it where the card is all there is", () => {
  // The overview and Session Prep show this card and nothing else. A state
  // with no reading behind it there would be an unexplained verdict.
  const t = text(renderToStaticMarkup(
    <RecoveryTrajectoryCard
      personId="p1" rows={rows} line={null} policyVersion="v" emptyNote={null}
    />
  ));
  assert.match(t, /Recent middle reading/);
  assert.match(t, /reconstructed after the fact/);
});

test("the trajectory page asks for findings only, and the other surfaces do not", () => {
  const page = code(read("src/app/clinician/member/[id]/trajectory/page.tsx"));
  assert.match(page, /explanation=\{false\}/,
    "the trajectory page prints each explanation twice");
  for (const f of [
    "src/app/clinician/member/[id]/page.tsx",
    "src/lib/clinical/command-context.ts",
  ]) {
    assert.doesNotMatch(code(read(f)), /explanation=\{false\}/,
      `${f} dropped the explanation from a card that is the only thing on the surface`);
  }
});

test("the explanation is still on the page, below", () => {
  // "Later", not "gone". The detail panels are what makes a state something a
  // clinician can open and disagree with.
  const page = code(read("src/app/clinician/member/[id]/trajectory/page.tsx"));
  assert.match(page, /classification\.explanation/,
    "the per-domain panels no longer print the explanation, so it is nowhere");
  const cardAt = page.indexOf("<RecoveryTrajectoryCard");
  const detailAt = page.lastIndexOf("classification.explanation");
  assert.ok(cardAt < detailAt, "the detail is above the findings");
});

// ---------------------------------------------------------------------------
// A description that cannot be read as a forecast — or as its own opposite
// ---------------------------------------------------------------------------

test("a domain inside a narrow band is not announced as having changed", () => {
  // THE CONTRADICTION THIS FIXES, on one screen: "Recovery trajectory changed
  // in Activation" printed directly above a badge reading "Within a narrow
  // band". A stall is worth attention — §8 is right about that — and it is
  // still not a change.
  const line = trajectoryLine(set([{ label: "Activation", state: "stalled" }]))!;
  assert.doesNotMatch(line, /changed/, `"${line}" calls a narrow band a change`);
  assert.match(line, /stayed inside a narrow band/);
});

test("a real change is still announced in the handoff's words", () => {
  const line = trajectoryLine(set([{ label: "Sleep quality", state: "reversing" }]))!;
  assert.match(line, /Recovery trajectory changed in Sleep quality/);
  assert.match(line, /across the current review window/);
});

test("a stall alongside a change is named separately, not folded in", () => {
  const line = trajectoryLine(set([
    { label: "Sleep quality", state: "reversing" },
    { label: "Activation", state: "stalled" },
  ]))!;
  assert.match(line, /changed in Sleep quality/);
  assert.doesNotMatch(line, /changed in Sleep quality, Activation/,
    "the stalled domain is listed among the ones that changed");
  assert.match(line, /Activation has stayed inside a narrow band/);
});

test("disagreement between domains still survives the split", () => {
  // §4: "a patient can improve in one domain and worsen in another. Preserve
  // the disagreement."
  const line = trajectoryLine(set([
    { label: "Sleep quality", state: "reversing" },
    { label: "Back to the allotment", state: "improving" },
    { label: "Activation", state: "stalled" },
  ]))!;
  assert.match(line, /while/);
  assert.match(line, /Back to the allotment moved favourably/);
  assert.match(line, /Activation has stayed inside a narrow band/);
  assert.ok(!/overall|net|on balance/i.test(line), line);
});

test("a quiet record is still not summarised as good news", () => {
  assert.equal(trajectoryLine(set([{ label: "Activation", state: "stable" }])), null);
});

test("no sentence this page can produce reads as a forecast", () => {
  const lines = [
    trajectoryLine(set([{ label: "Sleep quality", state: "reversing" }])),
    trajectoryLine(set([{ label: "Activation", state: "stalled" }])),
    trajectoryLine(set([{ label: "PHQ-9", state: "slowing" }])),
    trajectoryLine(set([{ label: "Goal", state: "improving" }])),
  ].filter(Boolean).join(" | ").toLowerCase();
  for (const word of [
    "will ", "expect", "likely", "predict", "forecast", "risk of", "heading", "on track",
  ]) {
    assert.ok(!lines.includes(word), `the sentence says "${word}", which is a claim about the future`);
  }
});

test("the non-forecast clause sits beside the findings, not only at the bottom", () => {
  // It is in the "what this cannot tell you" panel at the foot of the page too,
  // which is where a reader who has already formed a conclusion is not looking.
  const card = code(read("src/components/clinical/RecoveryTrajectoryCard.tsx"));
  assert.match(card, /none of it\s*\n?\s*says what will happen next/,
    "the card's boundary paragraph no longer says the states are not predictions");
  const page = code(read("src/app/clinician/member/[id]/trajectory/page.tsx"));
  assert.doesNotMatch(page, /boundary=\{false\}/,
    "the trajectory page suppresses the boundary paragraph beside its findings");
});

test("a row does not print the domain's name twice", () => {
  // On a check-in lane the domain and its type are the same word, so the row
  // read "Activation · Within a narrow band · Activation". Invisible while the
  // row also carried two lines of explanation; obvious once it was three words.
  const t = text(renderToStaticMarkup(
    <RecoveryTrajectoryCard
      personId="p1" policyVersion="v" line={null} emptyNote={null} explanation={false}
      rows={[{
        domainType: "activation", domainKey: "activation", label: "Activation",
        state: "stalled", headline: "", limitations: [],
      }]}
    />
  ));
  assert.equal((t.match(/Activation/g) ?? []).length, 1, `"${t}"`);
});

test("a row that carries a distinct type still shows it", () => {
  // PHQ-9 is a "Validated measure", and dropping that would lose the one word
  // saying the lane is an instrument rather than a self-report.
  const t = text(renderToStaticMarkup(
    <RecoveryTrajectoryCard
      personId="p1" policyVersion="v" line={null} emptyNote={null} explanation={false}
      rows={[{
        domainType: "measure", domainKey: "phq-9", label: "PHQ-9",
        state: "stable", headline: "", limitations: [],
      }]}
    />
  ));
  assert.match(t, /PHQ-9/);
  assert.match(t, /Validated measure/);
});
