import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  MAINTENANCE_TRANSITIONS, MAINTENANCE_CONTRACT, MAINTENANCE_COPY, maintenanceCopyFor,
  FORBIDDEN_MONITORING_LANGUAGE, monitoringLanguageProblems,
  MAINTENANCE_LANGUAGE_APPROVAL, maintenanceLanguageApproved, MAINTENANCE_HELD_REASON,
} from "../src/lib/clinical/maintenance";
import { reviewableSurfaces } from "../src/lib/review/clinical-copy";

// The maintenance state (17 September handoff, P5).
//
//   "Add a governed maintenance state for people leaving active between-visit
//   work. THE INTERFACE MUST NOT IMPLY ACTIVE CLINICIAN MONITORING WHEN NONE
//   EXISTS."
//
// That last sentence is the whole difficulty. Everything a maintenance screen
// naturally wants to say — "we will be keeping an eye on things", "check in and
// we will see how you are doing" — is a promise of attention. During active work
// it is roughly true: somebody has a queue with this person in it. In
// maintenance nobody does, and the words that were honest last month become a
// claim about staffing that nobody made.
//
// A person who believes they are being watched behaves as though they are:
// they wait rather than escalate, and they read silence as "nothing is wrong"
// rather than as "nobody is looking".

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

// ---------------------------------------------------------------------------
// The five transitions, and what each must say
// ---------------------------------------------------------------------------

test("the five transitions the handoff names are the five that exist", () => {
  assert.deepEqual([...MAINTENANCE_TRANSITIONS], [
    "active_to_maintenance", "tool_remains_available", "instruction_outdated",
    "warning_sign_reported", "return_to_active",
  ]);
});

test("leaving active work names what ends, what continues, who is accountable and when", () => {
  // A transition that names only what continues reads as nothing changing.
  assert.deepEqual([...MAINTENANCE_CONTRACT.active_to_maintenance.requires], [
    "what_ends", "what_continues", "who_is_responsible", "effective_time",
  ]);
});

test("returning to care needs a relationship, an eligibility check and a fresh decision", () => {
  // Coming back is a clinical decision, not a state change.
  assert.deepEqual([...MAINTENANCE_CONTRACT.return_to_active.requires], [
    "current_relationship", "eligibility_checked", "fresh_care_plan_decision",
  ]);
});

test("an outdated instruction expires rather than being rewritten", () => {
  const r = MAINTENANCE_CONTRACT.instruction_outdated.requires;
  assert.ok(r.includes("expired_not_rewritten"));
  assert.ok(r.includes("historical_assignment_kept"));
});

test("every transition says why it requires what it requires", () => {
  for (const t of MAINTENANCE_TRANSITIONS) {
    const c = MAINTENANCE_CONTRACT[t];
    assert.ok(c.requires.length > 0, `${t} requires nothing`);
    assert.ok(c.because.length > 40, `${t} does not say why`);
  }
});

// ---------------------------------------------------------------------------
// The sentence the product must never say
// ---------------------------------------------------------------------------

test("no maintenance sentence promises that anybody is watching", () => {
  // THE LOAD-BEARING ONE. Each forbidden phrase is a specific false promise:
  // the product cannot monitor, notice, or alert anybody in maintenance,
  // because there is no queue with this person in it.
  for (const c of MAINTENANCE_COPY) {
    const all = [c.member, ...c.supporting.map((s) => s.text)].join(" ");
    assert.deepEqual(monitoringLanguageProblems(all), [],
      `${c.transition} promises attention nobody is paying`);
  }
});

test("every forbidden phrase says what to write instead", () => {
  // A ban with no alternative gets worked around rather than followed.
  for (const f of FORBIDDEN_MONITORING_LANGUAGE) {
    assert.ok(f.instead.length > 20, `"${f.phrase}" is banned with no alternative`);
  }
});

test("the checker finds a promise when one is made", () => {
  const problems = monitoringLanguageProblems(
    "Keep checking in and we will be monitoring how you are doing."
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0].instead, /who to contact/);
});

test("the transition about warning signs says nobody reads it as it happens", () => {
  // The safety policy applies in maintenance exactly as in active work. What
  // changes is that nobody is watching for the report.
  const c = maintenanceCopyFor("warning_sign_reported");
  assert.match(c.member, /Nobody reads this page as it happens/);
  assert.match(c.supporting.map((s) => s.text).join(" "), /crisis line is open at any hour/);
});

test("leaving active work says plainly that nobody is reading day to day", () => {
  const c = maintenanceCopyFor("active_to_maintenance");
  assert.match(c.member, /nobody is reading what you record in them day to day/);
  assert.match(
    c.supporting.find((s) => s.fact === "who_is_responsible")!.text,
    /not reviewing it on a schedule/,
  );
});

test("every required fact has a sentence answering it", () => {
  for (const c of MAINTENANCE_COPY) {
    const answered = new Set(c.supporting.map((s) => s.fact));
    for (const fact of MAINTENANCE_CONTRACT[c.transition].requires) {
      assert.ok(answered.has(fact), `${c.transition} requires ${fact} and says nothing about it`);
    }
  }
});

// ---------------------------------------------------------------------------
// Held until somebody signs
// ---------------------------------------------------------------------------

test("the maintenance language is not approved, and the product knows it", () => {
  // The handoff's decision list: "approve the operating and monitoring language
  // before exposing it to patients."
  assert.equal(MAINTENANCE_LANGUAGE_APPROVAL.status, "awaiting_approval");
  assert.equal(maintenanceLanguageApproved(), false);
  assert.match(MAINTENANCE_HELD_REASON, /not been through clinical review/);
});

test("an approval with a status but no reviewer or date does not count", () => {
  // The same shape as the display-vocabulary approval one directory over: a
  // status flag anybody can flip is not an attestation.
  const src = read("src/lib/clinical/maintenance.ts");
  assert.match(src, /reviewers\.length > 0/);
  assert.match(src, /reviewedAt !== null/);
});

test("the words are on the screen where copy gets approved", () => {
  // HELD RATHER THAN HIDDEN. A feature built and left dark is invisible to the
  // person who has to approve it.
  const ids = reviewableSurfaces().map((s) => s.id);
  for (const t of MAINTENANCE_TRANSITIONS) {
    assert.ok(ids.includes(`maintenance.${t}`), `${t} is not reviewable anywhere`);
  }
  const surface = reviewableSurfaces().find((s) => s.id === "maintenance.warning_sign_reported")!;
  assert.equal(surface.claimClass, "safety");

  // HELD IS A FIELD, NOT A TURN OF PHRASE. This asserted /Held/ against
  // `appearsAt` while `appearsAt` held the sentence — and the screen duly
  // rendered "Appears at Held." A reviewer has to be able to tell a surface
  // nobody can reach from one a member reads today without parsing a
  // location for tone.
  assert.ok(surface.heldReason, "a withheld surface has to say so in the field the screen reads");
  assert.match(surface.heldReason!, /nothing shows them to a patient/);
  for (const s of reviewableSurfaces()) {
    if (s.id.startsWith("gate.")) {
      assert.equal(s.heldReason, null, `${s.id} ships today and must not read as held`);
    }
  }
});

test("nothing patient-facing renders maintenance copy", () => {
  // The whole point of holding it. A grep rather than a render check, because
  // the claim is about every member surface rather than one.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && /MAINTENANCE_COPY|maintenanceCopyFor/.test(fs.readFileSync(full, "utf8"))) {
        offenders.push(full);
      }
    }
  };
  walk(path.join(process.cwd(), "src/app/app"));
  walk(path.join(process.cwd(), "src/components/member"));
  assert.deepEqual(offenders, [],
    "a member surface renders maintenance copy that has not been approved");
});
