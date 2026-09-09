process.env.EMDR_DATA_DIR = `/tmp/steady-newpatient-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

// Creating a fabricated patient and onboarding them (demo only).
//
// WHAT THIS FEATURE IS FOR, and therefore what these guards protect: the seeded
// population writes the OUTCOME of onboarding, so nobody in it has ever
// answered the fitness screener, worked through 59 baseline items, or arrived in
// a caseload as somebody new. This creates a person who can.
//
// AND THE FAILURE MODE IS PARTICULAR TO IT. This is test data, so a lie here
// contaminates whatever it is used to check. Two shapes of lie:
//
//   • A state the product cannot produce. A demo patient who looks onboarded and
//     is refused by the gates, or whose rows sit in columns the real writers
//     never touch. Every guard about "the real writers" is about this.
//   • A patient who exists and reaches nobody. Measured twice while building
//     this: created in the admin's tenant they appeared in no caseload, and
//     created with an account but no membership they could not get past
//     /subscribe to the intake they existed to walk.
//
// Both were found by pressing the button rather than by reading the code, which
// is why the stage list is now checked against the gates it claims to satisfy.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  ONBOARDING_STAGES, STAGE_SPECS, DEPTHS, DEPTH_SPECS, stagesFor, includes,
  PRESENTATIONS, PRESENTATION_SPECS, answersFor, fitnessAnswers,
  fabricatedName, demoEmailFor, assertFabricatedInput, NotFabricatedError,
  FABRICATED_SUFFIX, DEMO_EMAIL_DOMAIN,
} from "../src/lib/demo/new-patient";
import { INSTRUMENTS, scoreInstrument } from "../src/lib/instruments";
import { FITNESS_ITEMS, classifyFitness } from "../src/lib/fitness-screener";

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// The stages are the product's own gates
// ---------------------------------------------------------------------------

test("every stage names the gate it satisfies", () => {
  // The whole point of the stage list is that "onboarded" means what the
  // product means by it. A stage that cannot name its predicate is a stage
  // somebody invented.
  assert.equal(ONBOARDING_STAGES.length, 7);
  for (const s of ONBOARDING_STAGES) {
    const spec = STAGE_SPECS[s];
    assert.ok(spec, `${s} has no spec`);
    assert.ok(spec.satisfies.trim().length > 0, `${s} names no gate`);
    assert.ok(spec.what.trim().length > 0, `${s} does not say what it writes`);
  }
});

test("every depth begins with an account and a membership", () => {
  // MEASURED. A patient with an account and no membership signed in and landed
  // on /subscribe: every member route checks `subscriptionActive` before
  // anything else, so the intake was behind a paywall and "walk it yourself"
  // was impossible. Membership is not a shortcut past a gate — it is the gate
  // that makes the others reachable.
  for (const d of DEPTHS) {
    const stages = stagesFor(d);
    assert.equal(stages[0], "account", `${d} does not start with an account`);
    assert.ok(includes(d, "membership"), `${d} creates a patient who cannot reach the programme`);
  }
});

test("the depths are nested, so a deeper one never skips a shallower stage", () => {
  // The product enforces these in order. A depth that wrote a baseline without
  // consent would be a state no member can reach, and the record would look
  // complete to a clinician reading it.
  const order = ONBOARDING_STAGES.map((s) => s as string);
  for (const d of DEPTHS) {
    const stages = stagesFor(d).map((s) => order.indexOf(s));
    const sorted = [...stages].sort((a, b) => a - b);
    assert.deepEqual(stages, sorted, `${d}'s stages are out of the product's order`);
    // Contiguous from the start: no holes.
    assert.deepEqual(stages, sorted.map((_, i) => i), `${d} skips a stage the product requires first`);
  }
});

test("the shallowest depth deliberately leaves the questionnaires undone", () => {
  // The reason that depth exists. Pre-filling the screener, the instruments or
  // the profile would remove the only thing a tester chose it to test.
  for (const s of ["fitness", "baseline", "profile", "consent"] as const) {
    assert.equal(includes("intake_only", s), false, `intake_only pre-fills ${s}`);
  }
  assert.ok(DEPTH_SPECS.intake_only.next.length > 40, "the shallow depth does not say what to do next");
});

test("every depth says what it is for and what to do next", () => {
  for (const d of DEPTHS) {
    assert.ok(DEPTH_SPECS[d].purpose.length > 60, `${d} does not say what it is for`);
    assert.ok(DEPTH_SPECS[d].next.length > 40, `${d} does not say what to do next`);
  }
});

// ---------------------------------------------------------------------------
// Nothing is written by a path the product does not use
// ---------------------------------------------------------------------------

test("the creator calls the product's writers rather than inventing rows", () => {
  // A seed that writes a shape the product cannot produce is a testing surface
  // that lies. This is the one feature where that contaminates everything it is
  // used to check.
  // MATCHED ON THE CALL, NOT THE IMPORT. The first version asserted the name
  // appeared in the file, which the import line satisfies on its own — so
  // replacing `scoreInstrument(...)` with hardcoded totals passed. This is the
  // third time that shape of guard has been caught in this codebase, so it is
  // now written as a call from the start.
  const src = code("lib/demo/new-patient-store.ts");
  for (const writer of [
    "provisionPerson", "startDemoSubscription", "recordFitnessScreening",
    "scoreInstrument", "recordAssessment", "recordCheckin", "computeReadiness",
  ]) {
    assert.match(
      src, new RegExp(`\\b${writer}\\(`),
      `the creator imports ${writer} and does not call it`
    );
  }
  // Aliased on import, so it is called under its local name.
  assert.match(src, /\bspineGrantConsent\(/, "consent is not granted through the spine");
});

test("the whole creation is one transaction", () => {
  // MEASURED: a version that failed part-way through the profile left a patient
  // with an account, a membership, a consent, a screener and five instruments —
  // half onboarded, already in a caseload, and indistinguishable from a real
  // one. A half-created patient is the worst output this feature could have.
  const src = code("lib/demo/new-patient-store.ts");
  assert.match(src, /return c\.tx\(async \(c\) => \{/, "the creation is not transactional");
});

test("the creator refuses to run outside a demonstration", () => {
  // Checked in the store as well as at the surface: a form post does not go
  // through the page that decided whether to render the form.
  const src = code("lib/demo/new-patient-store.ts");
  assert.match(src, /process\.env\.EMDR_DEMO !== "1"/);
  assert.match(src, /throw new NotDemoError/);
});

test("the tenant comes from the chosen clinician, never from the browser", () => {
  // MEASURED: the first version used the acting admin's tenant. The admin is in
  // the platform tenant and every clinician and member is in an organization
  // tenant, so the patient was created correctly and appeared in nobody's
  // caseload — the one thing the feature exists to do.
  const action = code("lib/demo/new-patient-actions.ts");
  assert.match(action, /assignableClinicians\(\)/, "the clinician is not looked up");
  assert.match(action, /clinicians\.find\(\(x\) => x\.id === clinicianId\)/,
    "a clinician id from the form is trusted rather than resolved");
  assert.match(action, /tenantId = clinician\.tenantId/, "the tenant is not the clinician's");
  assert.ok(
    !/formData\.get\("tenantId"\)/.test(action),
    "a tenant is accepted from the browser"
  );
});

test("the check-in row carries its tenant", () => {
  // src/lib/db.ts already carries a correction for exactly this, written the
  // last time it happened: a check-in inserted without a tenant takes the
  // column default — the platform tenant — while the person lives in the
  // clinician's, and replay rebuilds it into a different tenant than the live
  // row claims.
  const src = code("lib/demo/new-patient-store.ts");
  const insert = src.slice(src.indexOf("INSERT INTO checkins"), src.indexOf("recordCheckin({"));
  assert.match(insert, /tenant_id/, "the check-in is filed under the wrong tenant");
  assert.match(insert, /args\.tenantId/);
});

// ---------------------------------------------------------------------------
// The fabricated label, and what may be typed into the form
// ---------------------------------------------------------------------------

test("a created patient carries the fabricated label in their name", () => {
  // The banner and the persona indicator are chrome a reviewer stops seeing.
  // The suffix travels with the person — into a caseload row, a record header,
  // a session brief, an export.
  assert.equal(fabricatedName("Rowan Blake"), `Rowan Blake ${FABRICATED_SUFFIX}`);
  assert.equal(fabricatedName("  Rowan   Blake  "), `Rowan Blake ${FABRICATED_SUFFIX}`);
  // Idempotent: pasting a name that already carries it does not double it.
  assert.equal(fabricatedName(`Rowan Blake ${FABRICATED_SUFFIX}`), `Rowan Blake ${FABRICATED_SUFFIX}`);
});

test("an address that could belong to somebody is refused", () => {
  // Every handoff calls real-person information in this environment a stop
  // condition. A tester creating "a patient like the one I saw on Tuesday" is
  // not trying to break anything, and typing a real address is the most natural
  // thing in the world.
  assert.throws(
    () => assertFabricatedInput({ name: "Rowan", email: "rowan@gmail.com" }),
    NotFabricatedError
  );
  assert.throws(
    () => assertFabricatedInput({ name: "Rowan", email: "someone@hospital.nhs.uk" }),
    NotFabricatedError
  );
  assertFabricatedInput({ name: "Rowan", email: `rowan.new@${DEMO_EMAIL_DOMAIN}` });
  assertFabricatedInput({ name: "Rowan" });
  assert.throws(() => assertFabricatedInput({ name: "   " }), NotFabricatedError);
});

test("a generated address is confined to the demo domain", () => {
  assert.match(demoEmailFor("Rowan Blake"), new RegExp(`@${DEMO_EMAIL_DOMAIN}$`));
  assert.equal(demoEmailFor("Rowan Blake"), `rowan.blake.new@${DEMO_EMAIL_DOMAIN}`);
  // Punctuation and the suffix do not leak into an address.
  assert.equal(demoEmailFor(`O'Neill-Smith ${FABRICATED_SUFFIX}`), `o.neill.smith.new@${DEMO_EMAIL_DOMAIN}`);
});

// ---------------------------------------------------------------------------
// The baseline is a person, not five unrelated numbers
// ---------------------------------------------------------------------------

test("every instrument gets an answer for every item", () => {
  // The real submit path refuses a partial set. A patient created through a
  // path that skipped that refusal would prove nothing about the path a member
  // takes.
  for (const p of PRESENTATIONS) {
    for (const inst of INSTRUMENTS) {
      const key = inst.id as keyof (typeof PRESENTATION_SPECS)["moderate"]["answers"];
      const answers = answersFor(key, inst.items.length, p, (inst.riskItems ?? []).map((r) => r.index));
      assert.equal(answers.length, inst.items.length, `${inst.id} under ${p} is partially answered`);
      assert.ok(answers.every((a) => a >= 0), `${inst.id} under ${p} has an unanswered item`);
    }
  }
});

test("each presentation is consistent across all five instruments", () => {
  // A number entered by hand produces a person whose PHQ-9 and PCL-5 disagree
  // about how they are, which looks like data and is noise: a clinician cannot
  // tell a presentation from somebody's typo.
  const above = (p: (typeof PRESENTATIONS)[number]) =>
    INSTRUMENTS.filter((inst) => {
      const key = inst.id as keyof (typeof PRESENTATION_SPECS)["moderate"]["answers"];
      return scoreInstrument(inst, answersFor(key, inst.items.length, p, (inst.riskItems ?? []).map((r) => r.index))).positive;
    }).map((i) => i.id);

  // ALL FIVE, not "all with a numeric cutoff" — the first version of this
  // guard filtered on `cutoff < 900` and was wrong about the instrument it was
  // trying to exclude: the ITQ screens positive by its own ICD-11 section
  // criteria rather than by a total, so it is positive with cutoff 999. The
  // property being asserted is consistency across the five, and that is what it
  // now asserts.
  const all = INSTRUMENTS.map((i) => i.id).sort();
  assert.deepEqual(above("moderate").sort(), all, "the mid-scale preset is not positive on every instrument");
  assert.deepEqual(above("severe").sort(), all, "the top-of-scale preset is not positive on every instrument");
  assert.deepEqual(above("subthreshold"), [], "the sub-threshold preset screens positive somewhere");
});

test("a preset's label agrees with the totals it produces", () => {
  // A preset called "moderate" that produces PHQ-9 18 — moderately severe — is
  // the kind of disagreement a clinical reviewer notices first, and it makes
  // every other label suspect.
  const phq = INSTRUMENTS.find((i) => i.id === "phq-9");
  const pcl = INSTRUMENTS.find((i) => i.id === "pcl-5");
  assert.ok(phq && pcl);
  const total = (inst: typeof phq, p: (typeof PRESENTATIONS)[number]) =>
    scoreInstrument(inst!, answersFor(inst!.id as "phq-9", inst!.items.length, p, (inst!.riskItems ?? []).map((r) => r.index))).total;

  // READ THE NUMBER AFTER THE INSTRUMENT'S NAME, not every digit in the label:
  // a bare \d+ matches the 5 in "PCL-5" and the 9 in "PHQ-9", so the first
  // version of this guard failed on the instrument names rather than on the
  // totals.
  for (const p of PRESENTATIONS) {
    const label = PRESENTATION_SPECS[p].label;
    const pairs: Array<[string, typeof pcl]> = [["PCL-5", pcl], ["PHQ-9", phq]];
    for (const [name, inst] of pairs) {
      const m = label.match(new RegExp(`${name}\\s+(\\d+)`));
      if (!m) continue;
      assert.equal(
        Number(m[1]), total(inst, p),
        `${p}'s label claims ${name} ${m[1]}, and it produces ${total(inst, p)}`
      );
    }
  }
});

test("no preset creates a fabricated crisis", () => {
  // A fabricated patient who screens positive for risk would put a fabricated
  // emergency into a clinician's queue and route a fabricated person to the
  // crisis page. The product's safety path is where a demonstration must not
  // manufacture a fire drill; the seeded population's existing hard-stop alert
  // is where that path is exercised, deliberately and documented.
  for (const p of PRESENTATIONS) {
    for (const inst of INSTRUMENTS) {
      const key = inst.id as keyof (typeof PRESENTATION_SPECS)["moderate"]["answers"];
      const { riskFlags } = scoreInstrument(inst, answersFor(key, inst.items.length, p, (inst.riskItems ?? []).map((r) => r.index)));
      assert.deepEqual(riskFlags, [], `${p} raises ${riskFlags.join(", ")} on ${inst.id}`);
    }
  }
});

test("the fitness screener answers pass rather than hard-stop", () => {
  // A hard stop would hold the very sessions a created patient exists to
  // exercise, and a demo that creates a blocked patient by default teaches the
  // wrong lesson about the block.
  const answers = fitnessAnswers(FITNESS_ITEMS.map((i) => i.id));
  assert.equal(Object.keys(answers).length, FITNESS_ITEMS.length, "an item is unanswered");
  const { outcome } = classifyFitness(answers);
  assert.equal(outcome, "pass");
});

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

test("the form shows what it will and will not write, before it writes it", () => {
  // "Account only" means five things are deliberately left undone, and that is
  // invisible until somebody signs in and finds out.
  const src = code("components/demo/NewPatient.tsx");
  assert.match(src, /ONBOARDING_STAGES\.map/, "the form does not list the stages");
  assert.match(src, /includes\(depth, s\)/, "the list does not react to the depth");
  assert.match(src, /Left for them to do/, "an excluded stage is not named as excluded");
});

test("the surface hands over the credentials", () => {
  // A fabricated account nobody can sign in to is a row in a database.
  const src = code("components/demo/NewPatient.tsx");
  assert.match(src, /result\.email/);
  assert.match(src, /result\.password/);
  assert.match(src, /clinician\/patients|clinician\/caseload/, "no route to where they landed");
});

test("the surface is on the demo control centre and behind the demo-admin gate", () => {
  const page = code("app/admin/demo/page.tsx");
  assert.match(page, /<NewPatient clinicians=/);
  assert.match(page, /requireDemoAdmin\(\)/);
  const action = code("lib/demo/new-patient-actions.ts");
  assert.match(action, /requireDemoAdmin\(\)/, "the command does not check the role itself");
});
