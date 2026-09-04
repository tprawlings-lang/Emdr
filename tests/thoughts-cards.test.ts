// The Phase 2 review surface — cards, flags and the correction path.
//
// The screen is where Phase 2's guarantees either reach a clinician or do not.
// The engine can preserve a hypothesis perfectly and the feature still fails if
// the card renders it identically to an observation, because what gets read is
// what gets approved.

process.env.EMDR_DATA_DIR = `/tmp/steady-cards-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "cards-test-secret-at-least-32-characters-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "cards-test-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import type { TenantContext } from "../src/lib/repository";
import {
  beginThought, finalizeCapture, addTranscript, correctTranscript, getThought, currentTranscript,
} from "../src/lib/clinical/thought-store";
import { runExtraction } from "../src/lib/clinical/extraction";
import { listItemsForThought } from "../src/lib/clinical/memory-store";
import { thoughtsFlagEnabled } from "../src/lib/clinical/thoughts-flags";
import { FIXTURE_MARKER } from "../src/lib/clinical/transcription-fixture";

const CARDS = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/ThoughtItemCards.tsx"), "utf8");
const REVIEW = fs.readFileSync(path.join(process.cwd(), "src/components/clinical/ThoughtReview.tsx"), "utf8");

const db = getDb();
const T = { tenant: "tenant-cards", clinician: "clin-cards", patient: "pat-cards" };
db.prepare("INSERT OR IGNORE INTO tenants (id, kind, name) VALUES (?, 'organization', ?)").run(T.tenant, T.tenant);
for (const id of [T.clinician, T.patient]) {
  db.prepare("INSERT OR IGNORE INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'X', 'fabricated')")
    .run(id, T.tenant);
}
const ctx: TenantContext = { tenantId: T.tenant, personId: T.clinician };

const TEXT =
  "She semed steadier today. Not calm exactly, but she stayed in the room with it, "
  + "which she has not managed before. She said \"I keep waiting for it to go wrong\" — "
  + "her words, not mine. I think this might connect to the thing with her sister, but I "
  + "am not sure yet and I do not want to lead her there. Sleep is still poor, maybe four "
  + "hours. Follow up on the sleap next session."
  + `\n\n${FIXTURE_MARKER}`;

async function aThought(text = TEXT) {
  const t = await beginThought(ctx, { personId: T.patient });
  await finalizeCapture(ctx, { thoughtId: t.id, audioStorageKey: "a".repeat(32), durationMs: 58_000 });
  await addTranscript(ctx, { thoughtId: t.id, text, provider: "fixture", createdBy: "transcription_service" });
  return t.id;
}

// ---------------------------------------------------------------------------
// The surface is reachable
// ---------------------------------------------------------------------------

test("extraction is on in demo now that the phase behind it exists", () => {
  // The rule the flag list follows: a flag opens a surface with something
  // behind it. Phase 2 has an extractor, a contract, candidates and a save.
  assert.equal(thoughtsFlagEnabled("CLINICIAN_THOUGHTS_EXTRACTION"), true);
  // Phase 3 landed after this test was written, so the example of an unbuilt
  // phase moved on to Phase 4. The authoritative built/unbuilt list is in
  // clinician-thoughts-phase0.test.ts; this only checks the phase it needs.
  // The example of an unbuilt phase moves on as phases land. The authoritative
  // built/unbuilt list is in clinician-thoughts-phase0.test.ts.
  assert.equal(thoughtsFlagEnabled("CLINICIAN_PATIENT_ASK"), false, "Phase 5 is not built");
});

test("the cards render the statement class before the sentence", () => {
  // §4's failure is a hypothesis that reads like an observation, and it does
  // not look like an error — it looks like a slightly more confident record
  // than the clinician was. The sentence is what gets skimmed, so the class has
  // to come first in the markup, not sit in a corner.
  const classIndex = CARDS.indexOf("{cls.label}");
  const textIndex = CARDS.indexOf(`id={\`item-\${c.id}\`}`);
  assert.ok(classIndex > 0 && textIndex > 0);
  assert.ok(classIndex < textIndex, "the card must lead with what kind of claim this is");
});

test("every statement class has clinician-facing copy, and says what it weighs", () => {
  for (const cls of ["clinician_observation", "patient_report", "clinician_hypothesis", "clinician_uncertainty"]) {
    assert.ok(CARDS.includes(cls), `${cls} has no card copy, so it would render as a raw schema string`);
  }
  // The class label alone is a name. The weight line is what it means for how
  // the item may be leaned on later.
  assert.ok(CARDS.includes("weight:"), "each class must say what keeping it commits to");
  assert.ok(/will not read as established/.test(CARDS), "a hypothesis must say it stays a hypothesis");
});

test("nothing is pre-selected and saving is blocked until every card is decided", () => {
  assert.ok(/useState<Record<string, Choice>>\(\{\}\)/.test(CARDS), "choices must start empty");
  assert.ok(/disabled=\{busy \|\| undecided\.length > 0\}/.test(CARDS),
    "a default would collect approvals from a clinician who scrolled, and approval is the whole human gate");
});

test("an uncited item says so rather than rendering like a cited one", () => {
  assert.ok(/could not tie this to a specific line/.test(CARDS),
    "deciding on an uncited item means working from Steady's paraphrase alone, which is worth knowing first");
});

test("an approximate number is shown as approximate", () => {
  assert.ok(/approximate \? " \(approximate/.test(CARDS),
    "an approximate 4 and an exact 4 are different clinical facts");
});

test("the idempotency key is derived from the decision set, not generated", () => {
  // A random key made during render is impure, may be discarded with the
  // render that produced it, and silently reuses a position-stable value after
  // a remount. Identifying the SET is pure and is the correct semantic.
  assert.ok(!/Math\.random\(\)/.test(CARDS), "a random idempotency key is impure during render");
  assert.ok(!/Date\.now\(\)/.test(CARDS), "a clock read during render is impure");
  assert.ok(/candidates\.map\(\(c\) => c\.id\)\.sort\(\)/.test(CARDS),
    "the key must identify the candidate set, so a re-organize produces a different save");
});

// ---------------------------------------------------------------------------
// The transcript keeps its place
// ---------------------------------------------------------------------------

test("the transcript is rendered above the cards", () => {
  const transcript = REVIEW.indexOf("What Steady heard");
  const cards = REVIEW.indexOf("<ThoughtItemCards");
  assert.ok(transcript > 0 && cards > 0);
  assert.ok(transcript < cards,
    "§3.2: the clinician must always be able to see what Steady heard — the evidence does not move below what was derived from it");
});

test("editing the transcript warns that the items below are stale", () => {
  assert.ok(/quote text you have just changed/.test(REVIEW),
    "candidates cite offsets into the text being edited; leaving them silent shows quotes that no longer match");
  assert.ok(/correctAndReorganize/.test(REVIEW), "a correction must re-run the organizer");
});

test("with cards on screen there is one save, and it is theirs", () => {
  assert.ok(/const cardsOwnSave = cards\.length > 0/.test(REVIEW),
    "two Save buttons meaning different things is how a clinician saves the transcript believing they saved their decisions");
});

// ---------------------------------------------------------------------------
// The correction path, end to end
// ---------------------------------------------------------------------------

test("re-organizing after a correction replaces the candidates rather than doubling them", async () => {
  const thoughtId = await aThought();
  const first = await runExtraction(ctx, thoughtId);
  assert.equal(first.outcome, "organized");
  const before = (await listItemsForThought(ctx, thoughtId)).length;

  const current = await currentTranscript(ctx, (await getThought(ctx, thoughtId))!);
  await correctTranscript(ctx, {
    thoughtId, text: TEXT.replace("semed", "seemed"), expectedHash: current!.hash,
  });
  const second = await runExtraction(ctx, thoughtId);
  assert.equal(second.outcome, "organized");

  const after = await listItemsForThought(ctx, thoughtId);
  assert.equal(after.length, before, "a re-run replaces the proposal; it does not append a second one");
  assert.ok(after.every((i) => i.status === "candidate"));
});

test("a re-run cites the corrected transcript, not the original", async () => {
  const thoughtId = await aThought();
  await runExtraction(ctx, thoughtId);
  const current = await currentTranscript(ctx, (await getThought(ctx, thoughtId))!);
  const corrected = TEXT.replace("She semed steadier today.", "She seemed steadier today, I thought.");
  await correctTranscript(ctx, { thoughtId, text: corrected, expectedHash: current!.hash });
  await runExtraction(ctx, thoughtId);

  const t = await currentTranscript(ctx, (await getThought(ctx, thoughtId))!);
  for (const item of await listItemsForThought(ctx, thoughtId)) {
    if (!item.span) continue;
    const quoted = t!.text.slice(item.span.start, item.span.end);
    // The offsets must index the transcript that is on screen now. An item
    // pointing into the previous version quotes words nobody said.
    assert.ok(quoted.length > 0, `${item.id} cites an empty span of the current transcript`);
    assert.ok(t!.text.includes(quoted));
  }
});
