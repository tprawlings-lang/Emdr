// FAILURE-INJECTION EVIDENCE for the failure register's
// `safety.two-people-share-a-display-name`,
// `safety.shortcut-fires-inside-a-note-editor`,
// `safety.draft-opens-under-the-wrong-patient` and
// `safety.retrieved-material-carries-instructions`
// — see src/lib/governance/failure-register.ts.
//
// FOUR FAILURES WITH A CLINICAL CONSEQUENCE AND NO ERROR MESSAGE. An action
// taken against the wrong person, a note lost to a keystroke, a draft saved
// under somebody else, and a sentence in a transcript being read as an
// instruction. Each of them looks, from inside the software, like everything
// working.

process.env.EMDR_DATA_DIR = `/tmp/steady-safetyfail-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "safetyfail-test-key";
process.env.EMDR_SESSION_SECRET = process.env.EMDR_SESSION_SECRET ?? "safetyfail-test-secret-not-real";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";

import { getDb } from "../src/lib/db";
import { data } from "../src/lib/data";
import {
  disambiguate, nameFor, recordMark, RECORD_MARK_NOTE,
} from "../src/lib/clinical/disambiguate";
import { isEditing } from "../src/components/clinical/AttentionSignalDrawer";
import { saveDraft, noteById, NoteError } from "../src/lib/clinical/notes";

// ---------------------------------------------------------------------------
// Two people with one name
// ---------------------------------------------------------------------------

test("the population really does contain people who read identically", async () => {
  // NOT HYPOTHETICAL. The generator draws names from a list, so the fabricated
  // population has four people called one thing and three called another. A
  // scenario the data already contains is not a scenario to reason about.
  getDb();
  const c = await data();
  const dupes = (await c.all(
    `SELECT name, COUNT(*) AS n FROM users WHERE role = 'member' GROUP BY name HAVING n > 1`,
    [],
  )) as Array<{ name: string; n: number }>;
  assert.ok(
    dupes.length > 0,
    "the seeded population has no colliding names, so this scenario is not being exercised against real data",
  );
});

test("only the rows a reader could confuse are marked", () => {
  const rows = [
    { personId: "01AAAAAAAAAAAAAAAAAAAAAAAB", displayName: "Ines Mwangi (fabricated)" },
    { personId: "01CCCCCCCCCCCCCCCCCCCCCCCD", displayName: "Ines Mwangi (fabricated)" },
    { personId: "01EEEEEEEEEEEEEEEEEEEEEEEF", displayName: "Somebody Else (fabricated)" },
  ];
  const marked = disambiguate(rows);

  assert.ok(marked[0].mark, "two identical names, neither marked");
  assert.ok(marked[1].mark);
  assert.notEqual(marked[0].mark, marked[1].mark, "the two marks are the same, so they distinguish nothing");

  // MINIMUM EXPOSURE IS THE HARD HALF. Putting a record number beside every
  // name solves the collision by printing an identifier for everybody,
  // including the majority whose names are already unique — a standing
  // disclosure to anybody walking past the screen, bought for a problem those
  // rows do not have.
  assert.equal(marked[2].mark, null, "a unique name was given an identifier it does not need");
  assert.equal(nameFor(marked[2]), "Somebody Else (fabricated)");
  assert.match(nameFor(marked[0]), /Ines Mwangi \(fabricated\) · /);
});

test("the mark is a fact about the row, not about the person", () => {
  // A middle initial and a date of birth are both facts somebody can carry out
  // of the building. A slice of an opaque record id means nothing away from
  // this system and is exactly as good at telling two rows apart.
  const mark = recordMark("01HXYZABCDEFGHJKMNPQRSTV9Z");
  assert.equal(mark.length, 4);
  assert.match(mark, /^[A-Z0-9]{4}$/);
  assert.equal(recordMark("aaaa-bbbb-cccc-d1e2"), "D1E2");
  // And the screen can say what it is. A code nobody can explain is a number
  // people start treating as a patient identifier.
  assert.match(RECORD_MARK_NOTE, /means nothing outside Steady/);
});

test("ambiguity is scoped to the screen, not to the database", () => {
  // The same person, alone on a screen, is not ambiguous and gets no mark.
  const alone = disambiguate([
    { personId: "01AAAAAAAAAAAAAAAAAAAAAAAB", displayName: "Ines Mwangi (fabricated)" },
  ]);
  assert.equal(alone[0].mark, null);
  // Case and surrounding space do not make two identical names look different.
  const sneaky = disambiguate([
    { personId: "01A", displayName: "Ines Mwangi (fabricated)" },
    { personId: "01B", displayName: "  ines mwangi (Fabricated)  " },
  ]);
  assert.ok(sneaky[0].mark && sneaky[1].mark, "a difference in case hid a collision");
});

// ---------------------------------------------------------------------------
// A shortcut inside a note editor
// ---------------------------------------------------------------------------

test("Escape does not close a drawer out from under somebody who is typing", () => {
  // THE DRAWER CONTAINS A NOTE FIELD and Escape closed it from anywhere, so a
  // clinician half-way through writing what they did about a safety signal
  // lost it to a key people press to mean "get rid of the autocomplete". The
  // keystroke costs nothing anywhere else in the drawer, which is why it went
  // unnoticed: the one place it costs something is the one place there is
  // something to lose.
  assert.equal(isEditing({ tagName: "TEXTAREA" } as unknown as EventTarget), true);
  assert.equal(isEditing({ tagName: "INPUT", type: "text" } as unknown as EventTarget), true);
  assert.equal(isEditing({ tagName: "INPUT", type: "search" } as unknown as EventTarget), true);
  assert.equal(isEditing({ tagName: "SELECT" } as unknown as EventTarget), true);
  assert.equal(isEditing({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);

  // AND IT STILL CLOSES FROM EVERYWHERE ELSE. A drawer that could not be
  // dismissed by Escape would be a worse keyboard trap than the one this fixes.
  assert.equal(isEditing({ tagName: "BUTTON" } as unknown as EventTarget), false);
  assert.equal(isEditing({ tagName: "A" } as unknown as EventTarget), false);
  assert.equal(isEditing({ tagName: "INPUT", type: "checkbox" } as unknown as EventTarget), false);
  assert.equal(isEditing({ tagName: "INPUT", type: "radio" } as unknown as EventTarget), false);
  assert.equal(isEditing(null), false);
});

test("the drawer's Escape handler consults that rule rather than a copy of it", () => {
  const src = fs.readFileSync("src/components/clinical/AttentionSignalDrawer.tsx", "utf8");
  const at = src.indexOf('if (e.key === "Escape")');
  assert.ok(at > 0, "the drawer no longer handles Escape at all");
  assert.match(
    src.slice(at, at + 1200),
    /if \(isEditing\(e\.target\)\) return;/,
    "Escape closes the drawer from inside a text field again",
  );
});

test("no destructive single-key command exists anywhere", () => {
  // "Avoid destructive single-key commands." The rule is easiest to keep while
  // there are none: this walks the components for a bare key handler that
  // deletes, discards or submits, so the first one added has to argue with a
  // test rather than with a convention.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(full, "utf8");
      // A single-character key compared directly, next to something that acts.
      if (/e\.key === "[a-zA-Z]"/.test(src) && /(delete|remove|discard|submit|destroy)/i.test(src)) {
        offenders.push(full);
      }
    }
  };
  walk("src/components");
  assert.deepEqual(offenders, [], "a single letter key triggers something destructive");
});

// ---------------------------------------------------------------------------
// Retrieved text that tries to give instructions
// ---------------------------------------------------------------------------

test("retrieved material cannot become an instruction, because nothing follows instructions", () => {
  // "Treat source text as data, never permission or executable instruction."
  //
  // THE STRONGEST FORM OF THIS GUARANTEE IS AN ABSENCE. A member's transcript,
  // a clinician's note and a retrieved memory item are all text somebody else
  // wrote, and the answer built from them is assembled by a deterministic rules
  // engine — there is no model in the path to be instructed, because no API key
  // is configured and the gateway says so. A prompt-injection defence that
  // depended on filtering would be weaker than the one that exists.
  const provider = fs.readFileSync("src/lib/ai-gateway/provider.ts", "utf8");
  assert.match(provider, /ANTHROPIC_API_KEY/, "the gateway no longer states what would enable a model");
  assert.match(
    provider,
    /the companion uses the built-in rules engine/,
    "the gateway no longer says what answers when no model is configured",
  );

  // And the guard that exists for the day one IS configured checks OUTPUT
  // rather than trusting the producer — the same discipline the summary
  // validator uses.
  const guard = fs.readFileSync("src/lib/safety/companion-guard.ts", "utf8");
  assert.match(guard, /validateCompanionOutput/);
  assert.match(guard, /buildGuardrailBlock/);
});

// ---------------------------------------------------------------------------
// A draft saved against the wrong person
// ---------------------------------------------------------------------------

test("a draft cannot be saved against a person it does not belong to", async () => {
  // THE INJECTION: a clinician with two records open, or a page that navigated
  // between the editor being opened and save being pressed. The note is found
  // by its own id, so the body lands on the note it came from whatever the form
  // said — but the form also said a person, and nothing checked that the two
  // agreed. The redirect, the confirmation and the breadcrumb would all name
  // the wrong person over a note belonging to the right one: not a disclosure,
  // since both are in one tenant, but a clinician being told they wrote
  // something they did not.
  const db = getDb();
  const c = await data();
  const tenant = ((await c.get("SELECT id FROM tenants LIMIT 1", [])) as { id: string }).id;
  // clinical_notes references users on both ends, and persons for provenance.
  for (const [id, role] of [
    ["sf-person-a", "member"], ["sf-person-b", "member"], ["sf-clin", "clinician"],
  ] as const) {
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
       VALUES (?, ?, ?, ?, 'x', 'active', ?) ON CONFLICT(id) DO NOTHING`,
    ).run(id, `${id}@example.test`, id, role, tenant);
    db.prepare(
      "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated') ON CONFLICT(id) DO NOTHING",
    ).run(id, tenant, id);
  }

  const { id } = await saveDraft({
    personId: "sf-person-a", tenantId: tenant, clinicianId: "sf-clin",
    kind: "session", body: "What we worked on today, written for person A.",
  });

  await assert.rejects(
    () => saveDraft({
      noteId: id, personId: "sf-person-b", tenantId: tenant, clinicianId: "sf-clin",
      kind: "session", body: "Edited while the page was showing person B.",
    }),
    (e: Error) => e instanceof NoteError && /belongs to a different person/i.test(e.message),
    "a draft was saved under a person it does not belong to",
  );

  // AND NOTHING WAS WRITTEN. A refusal that had already updated the body would
  // be the same defect with a message on top.
  const after = await noteById(id, tenant);
  assert.match(after!.body, /written for person A/);
  assert.equal(after!.personId, "sf-person-a");

  // The same call against the right person still works — a guard that refused
  // every edit would be worse than the gap.
  const ok = await saveDraft({
    noteId: id, personId: "sf-person-a", tenantId: tenant, clinicianId: "sf-clin",
    kind: "session", body: "A second pass, same person.",
  });
  assert.equal(ok.forked, false);
  assert.match((await noteById(id, tenant))!.body, /A second pass/);
});
