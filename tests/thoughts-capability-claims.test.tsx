import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ThoughtsCapabilities } from "../src/components/clinical/ThoughtsCapabilities";
import {
  THOUGHTS_FLAGS, THOUGHTS_SURFACE, thoughtsCapabilities, thoughtsSurfaceAvailable,
} from "../src/lib/clinical/thoughts-flags";

// UX 005: "Thoughts contains stale future-phase copy beside working functions.
// Remove implementation commentary and standardize product terms. Acceptance:
// no contradictory capability claims remain."
//
// The page told a clinician that "session preparation and patient-scoped
// questions are built in later phases" while the patient-scoped question box
// rendered a few hundred pixels above the sentence and session preparation sat
// one click away on the record overview. Both had shipped; nobody had re-read
// the paragraph.
//
// The fix is not better prose. It is that a claim about what exists is now read
// from the same function that decides whether the thing renders.

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const visible = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
   .replace(/\/\*[\s\S]*?\*\//g, " ")
   .replace(/^\s*\/\/.*$/gm, " ");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function withFlags<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("every capability has words a clinician can read, and a place to find it", () => {
  // A flag added without an entry would be a capability the screen cannot
  // describe — which is how the page came to describe a shipped one as future.
  for (const flag of THOUGHTS_FLAGS) {
    const s = THOUGHTS_SURFACE[flag];
    assert.ok(s, `${flag} has no description, so no screen can say whether it is here`);
    assert.ok(s.name.length > 3 && s.does.length > 20 && s.where.length > 8, `${flag} is described thinly`);
    // No implementation commentary: not the flag, not the phase number.
    assert.doesNotMatch(`${s.name} ${s.does} ${s.where}`, /phase\s*\d|CLINICIAN_|flag/i,
      `${flag} describes itself in our words rather than a clinician's`);
  }
});

test("the claim is derived from the switch that decides the surface", () => {
  process.env.EMDR_DEMO = "1";
  const on = withFlags({ CLINICIAN_PATIENT_ASK: undefined }, () =>
    thoughtsCapabilities().find((c) => c.flag === "CLINICIAN_PATIENT_ASK")!);
  assert.equal(on.available, thoughtsSurfaceAvailable("CLINICIAN_PATIENT_ASK"));

  const off = withFlags({ CLINICIAN_PATIENT_ASK: "0" }, () =>
    thoughtsCapabilities().find((c) => c.flag === "CLINICIAN_PATIENT_ASK")!);
  assert.equal(off.available, false, "turning the surface off left the claim saying it is here");
});

test("a capability that is on is not described as somewhere else or still to come", () => {
  process.env.EMDR_DEMO = "1";
  const html = renderToStaticMarkup(<ThoughtsCapabilities />);
  const body = text(html);

  for (const c of thoughtsCapabilities()) {
    assert.ok(body.includes(c.name), `${c.flag} is not reported at all`);
  }
  assert.doesNotMatch(body, /later phase|future phase|coming soon|will be built|not yet built/i,
    "a shipped capability is still described as future");
  assert.ok(!body.includes("Switched off in this environment."),
    "everything is on in demo, so nothing should report as off");
});

test("a capability that is off says so, rather than disappearing", () => {
  // Absence is a state with a name. A missing row reads as "we never built
  // this", which is a different and worse message than "this is closed here".
  process.env.EMDR_DEMO = "1";
  const body = withFlags({ CLINICIAN_THREADS: "0" }, () =>
    text(renderToStaticMarkup(<ThoughtsCapabilities />)));
  assert.ok(body.includes("Themes"), "a switched-off capability vanished from the list");
  assert.ok(body.includes("Switched off in this environment."));
  assert.match(body, /Nothing recorded before is lost/,
    "the screen does not say that turning a capability off keeps the history");
});

test("the Thoughts page makes no capability claim in prose", () => {
  // THE DEFECT ITSELF. Checked on what the page renders, with comments stripped
  // — a guard that matched a comment would be reading the thing next to the
  // thing, and this file's own subject is sentences about capabilities.
  const page = visible(read("src/app/clinician/member/[id]/thoughts/page.tsx"));
  assert.doesNotMatch(page, /later phases?|future phases?|built in later|those phases will/i,
    "the page claims a capability is future; the list above answers that from the switches");
  assert.doesNotMatch(page, /Phase \d/,
    "a phase number is implementation commentary and means nothing to a clinician");
  assert.match(page, /ThoughtsCapabilities/,
    "the page no longer reports what it can do, so the question is unanswered rather than answered wrongly");
});

test("the product term for a signed record is the same on both screens", () => {
  // "Standardize product terms." The draft screen sent a clinician to approve
  // items on "Notes" — the name of a different screen, holding signed clinical
  // notes — when the items are approved on Thoughts.
  const note = visible(read("src/app/clinician/member/[id]/note/page.tsx"));
  const link = /<Link href=\{`\/clinician\/member\/\$\{id\}\/thoughts`\}[^>]*>([^<]+)<\/Link>/.exec(note);
  assert.ok(link, "the draft screen no longer links to where items are approved");
  assert.equal(link![1].trim(), "Thoughts",
    `the link to /thoughts is labelled "${link![1].trim()}", which is the name of another screen`);
});
