// Notes attached to the session they came from.
//
// THE GAP THIS CLOSES WAS NOT A MISSING FIELD. `clinician_thoughts` has had
// `source_session_id` since Phase 0 and `beginThought` has always accepted it;
// what was missing was an entry point that knew which session it was on, so
// nothing ever set it. Every note was about a PERSON.
//
// AND THE CONSEQUENCE WAS IN SESSION PREP, NOT IN THE RECORD. The brief's
// "Last session" section printed the NEWEST note, whatever session it
// concerned — so a note written three sessions ago read as a note about last
// time, in a document a clinician reads in the minute before they walk into
// the room, with nothing on the screen to tell them otherwise.
//
// So the guards below are about three things:
//
//   THE ID IS VERIFIED AGAINST THE PERSON. It arrives from a form field, and a
//   clinician with two records open has two session ids in play. Attaching one
//   patient's session to another patient's note happens INSIDE the tenant,
//   where no tenancy guard would see it.
//
//   THE BRIEF IS ONLY AS SPECIFIC AS ITS EVIDENCE. Three wordings: attached to
//   this session, attached to a different one (named), attached to none (dated,
//   and claiming nothing about what it was about).
//
//   ONE WORDING ACROSS SURFACES. The recorder, the note list and the brief all
//   name a session through src/lib/clinical/session-label.ts, because two
//   phrasings of the same row is the failure this feature exists to fix,
//   reintroduced one layer up.

// ITS OWN DATABASE. Every other test file in this suite sets EMDR_DATA_DIR
// before the first import, and this one did not — so its `beginThought` calls
// and its inserted therapy_sessions went into .data/emdr.db, the database the
// dev server serves. Which is how the demo-seed tenant bug below got noticed
// and is still the wrong way to run a test: rows a test writes must not reach
// a screen a person opens.
process.env.EMDR_DATA_DIR = `/tmp/steady-linkednotes-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, PLATFORM_TENANT_ID } from "../src/lib/db";
import { demoId } from "../src/lib/demo-seed";
import { ulid } from "../src/lib/ids";
import type { TenantContext } from "../src/lib/repository";
import {
  beginThought, sessionForPerson, assertSessionForPerson, SessionNotForPersonError,
} from "../src/lib/clinical/thought-store";
import {
  sessionLabel, sessionHeading, labelsFor,
} from "../src/lib/clinical/session-label";
import { assemble, type PrepInputs } from "../src/lib/clinical/session-prep";
import type { TimelineEntry } from "../src/lib/clinical/timeline";

const db = getDb();
const ctx: TenantContext = { tenantId: PLATFORM_TENANT_ID, personId: demoId(2) };
const MEMBER = demoId(0);
const OTHER = demoId(1);
const NOW = new Date("2026-09-04T10:00:00.000Z");

const SRC = path.join(__dirname, "..", "src");
const read = (p: string) => fs.readFileSync(path.join(SRC, p), "utf8");

/** A session on somebody's record. Inserted directly: the point of these
 *  guards is the boundary between a session id and a person, and going through
 *  the session engine would test the engine instead. */
function insertSession(userId: string, moduleId: string, startedAt: string): string {
  const id = ulid();
  db.prepare(
    `INSERT INTO therapy_sessions (id, user_id, module_id, status, started_at)
     VALUES (?, ?, ?, 'completed', ?)`
  ).run(id, userId, moduleId, startedAt);
  return id;
}

// ---------------------------------------------------------------------------
// The id is verified against the person
// ---------------------------------------------------------------------------

test("a note can be attached to a session on the person's own record", async () => {
  const sid = insertSession(MEMBER, "calm-place", "2026-09-01 09:00:00");
  const found = await sessionForPerson(ctx, { personId: MEMBER, sessionId: sid });
  assert.ok(found, "the person's own session did not resolve");
  assert.equal(found!.id, sid);
  assert.equal(found!.moduleId, "calm-place");

  const thought = await beginThought(ctx, { personId: MEMBER, sourceSessionId: sid });
  assert.equal(thought.sourceSessionId, sid);
});

test("a session from another person's record cannot be attached", async () => {
  // INSIDE THE TENANT, which is why the person is in the predicate and not
  // only the tenant. Both records are in the same organisation; a clinician
  // with two open has two session ids in play, and the one that gets typed
  // into a hidden field is not always the one on screen.
  const theirs = insertSession(OTHER, "calm-place", "2026-09-01 09:00:00");
  assert.equal(await sessionForPerson(ctx, { personId: MEMBER, sessionId: theirs }), null);
  await assert.rejects(
    () => assertSessionForPerson(ctx, { personId: MEMBER, sessionId: theirs }),
    SessionNotForPersonError
  );
});

test("an id that is not a session at all cannot be attached", async () => {
  await assert.rejects(
    () => assertSessionForPerson(ctx, { personId: MEMBER, sessionId: "not-a-session" }),
    SessionNotForPersonError
  );
});

test("the refusal says what to do rather than naming a column", async () => {
  try {
    await assertSessionForPerson(ctx, { personId: MEMBER, sessionId: "nope" });
    assert.fail("no refusal");
  } catch (e) {
    const message = (e as Error).message;
    assert.ok(!/source_session_id|therapy_sessions|SELECT/i.test(message), message);
    assert.match(message, /not on this person's record/i);
  }
});

test("both write paths verify the id before storing it", () => {
  // The store's refusal is only a refusal if the actions call it. Both entry
  // points — spoken and typed — are checked, because the typed one was added
  // later and is the one a reader forgets.
  const src = read("lib/clinical/thought-actions.ts");
  const started = src.slice(src.indexOf("export async function startThoughtAction"));
  const startBody = started.slice(0, started.indexOf("\n}"));
  assert.match(startBody, /assertSessionForPerson/, "startThoughtAction stores an unverified id");

  const written = src.slice(src.indexOf("export async function writeThoughtAction"));
  const writeBody = written.slice(0, written.indexOf("\n}"));
  assert.match(writeBody, /assertSessionForPerson/, "writeThoughtAction stores an unverified id");
  // And neither passes the raw form value straight through to beginThought.
  assert.ok(
    !/beginThought\(ctx, \{ personId, sourceSessionId: sourceSessionId \}/.test(src),
    "an unverified form value reaches beginThought"
  );
});

test("reading a note's session back is scoped to the person too", async () => {
  // DEFENCE IN DEPTH, and it is not theoretical. The write path verifies the
  // id, so a wrong-person link cannot be created today — but rows outlive the
  // code that wrote them, and a read that resolved any id in the tenant to a
  // label would print another patient's session on this patient's note the
  // first time one existed. Both display paths pass the person.
  for (const [file, needle] of [
    ["app/clinician/member/[id]/thoughts/page.tsx", "sessionForPerson(ctx, { personId: id, sessionId: sid })"],
    ["lib/clinical/session-prep.ts", "sessionForPerson(ctx, { personId, sessionId: sid })"],
  ] as const) {
    assert.ok(
      read(file).includes(needle),
      `${file} resolves a session label without scoping to the person`
    );
  }
});

test("a note with no session is still an ordinary note", async () => {
  // The case that has always worked and must keep working: the Thoughts page
  // is about a person, and every note written before this change names no
  // session. Making the link mandatory would have broken the ordinary path to
  // fix the labelled one.
  const thought = await beginThought(ctx, { personId: MEMBER });
  assert.equal(thought.sourceSessionId, null);
});

// ---------------------------------------------------------------------------
// One wording
// ---------------------------------------------------------------------------

test("a session reads as a session somebody ran, not as a row", () => {
  const label = sessionLabel({ id: "s1", moduleId: "calm-place", startedAt: "2026-09-01 09:00:00" });
  assert.match(label, /on 1 September/);
  // No year and no clock: a note is attached within days of the session, and a
  // timestamp to the second reads as a database key.
  assert.ok(!/2026/.test(label), label);
  assert.ok(!/09:00/.test(label), label);
  // And it names the module rather than its id.
  assert.ok(!/calm-place/.test(label), label);
});

test("the time appears only where the date repeats", () => {
  const a = { id: "a", moduleId: "calm-place", startedAt: "2026-09-01 09:00:00" };
  const b = { id: "b", moduleId: "calm-place", startedAt: "2026-09-01 16:30:00" };
  const c = { id: "c", moduleId: "calm-place", startedAt: "2026-09-02 09:00:00" };

  const two = labelsFor([a, b, c]);
  assert.match(two.get("a")!, /at 09:00/);
  assert.match(two.get("b")!, /at 16:30/);
  // The one that is unambiguous does not carry a clock — a disambiguator on
  // every row makes the reader check all of them.
  assert.ok(!/at \d\d:\d\d/.test(two.get("c")!), two.get("c")!);

  const one = labelsFor([a, c]);
  assert.ok(!/at \d\d:\d\d/.test(one.get("a")!), one.get("a")!);
});

test("the heading and the sentence name the same session in the same words", () => {
  const s = { id: "s1", moduleId: "calm-place", startedAt: "2026-09-01 09:00:00" };
  // Different grammar, same facts — so a clinician who saw the recorder's
  // heading recognises the brief's sentence.
  assert.match(sessionHeading(s), /1 September/);
  assert.match(sessionLabel(s), /1 September/);
});

test("no panel states the attachment three times", () => {
  // The defect the trajectory and load panels each had once: a screen that
  // states its own boundary in every slot that has room for it. Both controls
  // name the session, because that is where a wrong-session error is caught;
  // the footnote says what the attachment is FOR, which is the thing the
  // controls cannot say.
  const src = read("app/clinician/member/[id]/session/[sid]/page.tsx");
  const panel = src.slice(src.indexOf('title="A note about this session"'), src.indexOf("</Panel>"));
  const footnote = panel.slice(panel.indexOf("footnote="));
  const text = footnote.slice(0, footnote.indexOf("\n"));
  // The footnote says what the attachment is FOR and does not restate it. Two
  // controls above already name the session, and neither the word nor an
  // interpolation of the session belongs in a third sentence.
  assert.ok(!/attach/i.test(text), `the footnote restates the attachment: ${text}`);
  assert.ok(!/\$\{/.test(text), `the footnote interpolates the session: ${text}`);
  assert.match(panel, /Session Prep can then say which session/);
});

test("one session is named in one format on one screen", () => {
  // It read "2026-06-12 15:00" directly above a panel saying "12 June".
  const src = read("app/clinician/member/[id]/session/[sid]/page.tsx");
  assert.ok(
    !/s\.started_at\.slice\(0, 16\)/.test(src),
    "the session heading still renders a raw timestamp"
  );
  assert.match(src, /sessionDay\(sessionRef\)/);
});

test("every surface names a session through the one helper", () => {
  for (const file of [
    "app/clinician/member/[id]/session/[sid]/page.tsx",
    "app/clinician/member/[id]/thoughts/page.tsx",
    "lib/clinical/session-prep.ts",
  ]) {
    assert.match(
      read(file),
      /from "[^"]*session-label"/,
      `${file} composes its own wording for a session`
    );
  }
});

// ---------------------------------------------------------------------------
// The brief is only as specific as its evidence
// ---------------------------------------------------------------------------

function inputs(over: Partial<PrepInputs> = {}): PrepInputs {
  return {
    timeline: {
      personId: MEMBER, entries: [], laneCounts: {}, reconstructedCount: 0,
      withheld: { count: 0, reason: "" }, policyVersion: "p", asOf: null,
    },
    memory: [], followUps: [], threads: [], threadEntries: [], goals: [], notes: [],
    responses: [], trajectory: [], load: null, now: NOW,
    ...over,
  };
}

function sessionEntry(sessionId: string, occurredAt: string): TimelineEntry {
  return {
    eventId: `ev-${sessionId}`,
    // "care" is the sessions lane. Named from the type rather than guessed,
    // because a lane the timeline does not know would make these fixtures
    // describe a shape the product cannot produce.
    lane: "care",
    type: "session.completed",
    occurredAt,
    recordedAt: occurredAt,
    actorType: "member",
    actorId: MEMBER,
    headline: "Session completed.",
    detail: { sessionId },
    reconstructed: false,
    aiProduced: false,
    correlationId: null,
  };
}

function note(over: Partial<PrepInputs["notes"][number]> = {}): PrepInputs["notes"][number] {
  return {
    thoughtId: "t1", text: "She talked about her sister.",
    recordedAt: "2026-09-01T10:00:00.000Z", typed: false, ...over,
  };
}

test("a note attached to the last session says so", () => {
  const claims = assemble(inputs({
    timeline: {
      ...inputs().timeline,
      entries: [sessionEntry("s-last", "2026-09-03T09:00:00.000Z")],
    },
    notes: [note({ thoughtId: "t1", sourceSessionId: "s-last" })],
  }));
  const line = claims.find((c) => c.text.includes("She talked about her sister"));
  assert.ok(line, "the note did not reach the brief");
  assert.match(line!.text, /from that session/);
});

test("a note about an older session names that session instead of borrowing the heading", () => {
  // THE DEFECT, DIRECTLY. Before this change the newest note went under "Last
  // session" with no qualifier at all, so this exact input produced a brief
  // that told a clinician their words were about a session they were not about.
  const claims = assemble(inputs({
    timeline: {
      ...inputs().timeline,
      entries: [sessionEntry("s-last", "2026-09-03T09:00:00.000Z")],
    },
    notes: [note({
      thoughtId: "t-old",
      sourceSessionId: "s-older",
      sourceSessionLabel: "the Calm Place session on 20 August",
    })],
  }));
  const line = claims.find((c) => c.text.includes("She talked about her sister"));
  assert.ok(line);
  assert.match(line!.text, /from the Calm Place session on 20 August/);
  assert.ok(!/from that session/.test(line!.text), line!.text);
});

test("a note attached to the last session wins over a newer unattached one", () => {
  // Newest-first is the right default and the wrong answer here: the section is
  // about one session, and a note that names it is better evidence for that
  // section than a more recent note that names nothing.
  const claims = assemble(inputs({
    timeline: {
      ...inputs().timeline,
      entries: [sessionEntry("s-last", "2026-09-03T09:00:00.000Z")],
    },
    notes: [
      note({ thoughtId: "t-new", text: "A general thought.", recordedAt: "2026-09-04T08:00:00.000Z" }),
      note({ thoughtId: "t-linked", text: "About that session.", sourceSessionId: "s-last" }),
    ],
  }));
  const lines = claims.filter((c) => c.section === "last_session" && c.text.includes("“"));
  assert.equal(lines.length, 1, "the brief quoted more than one note");
  assert.match(lines[0].text, /About that session/);
  assert.deepEqual(lines[0].citations, ["t-linked"]);
});

test("a note attached to nothing is dated and claims nothing about what it was about", () => {
  const claims = assemble(inputs({
    timeline: {
      ...inputs().timeline,
      entries: [sessionEntry("s-last", "2026-09-03T09:00:00.000Z")],
    },
    notes: [note({ thoughtId: "t1", recordedAt: "2026-09-01T10:00:00.000Z" })],
  }));
  const line = claims.find((c) => c.text.includes("She talked about her sister"));
  assert.ok(line);
  assert.match(line!.text, /written 1 September/);
  assert.ok(!/from that session|from the/.test(line!.text), line!.text);
});

test("the brief matches a session by its id, never by its date", () => {
  // Two sessions on one day is the case a date match gets wrong, and getting it
  // wrong means attributing a clinician's words to the wrong session — which is
  // the whole defect, with a different cause.
  const claims = assemble(inputs({
    timeline: {
      ...inputs().timeline,
      entries: [sessionEntry("s-evening", "2026-09-03T18:00:00.000Z")],
    },
    notes: [note({
      thoughtId: "t-morning",
      sourceSessionId: "s-morning",
      sourceSessionLabel: "the Calm Place session on 3 September at 09:00",
      recordedAt: "2026-09-03T10:00:00.000Z",
    })],
  }));
  const line = claims.find((c) => c.text.includes("She talked about her sister"));
  assert.ok(line);
  assert.ok(
    !/from that session/.test(line!.text),
    `a same-day note was treated as the evening session's: "${line!.text}"`
  );
  assert.match(line!.text, /at 09:00/);
});

test("a note still cites the thought it came from, not the session", () => {
  // The citation is what makes the claim survive the validator, and it has to
  // be something the clinician is authorized to read. Their own thought is;
  // a session id is a different kind of thing and was never in the set.
  const claims = assemble(inputs({
    timeline: {
      ...inputs().timeline,
      entries: [sessionEntry("s-last", "2026-09-03T09:00:00.000Z")],
    },
    notes: [note({ thoughtId: "t-cited", sourceSessionId: "s-last" })],
  }));
  const line = claims.find((c) => c.text.includes("She talked about her sister"));
  assert.deepEqual(line!.citations, ["t-cited"]);
});

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

test("the session-response screen offers a note attached to that session", () => {
  // The standing constraint on this project: a capability that is not on the
  // site is not built. The field existed for five phases and nothing set it.
  const src = read("app/clinician/member/[id]/session/[sid]/page.tsx");
  assert.match(src, /sourceSession=\{\{ id: s\.id/, "the screen does not pass its own session");
  // Behind capture's own flag, like every other entry point to this pipeline.
  assert.match(src, /thoughtsSurfaceAvailable\("CLINICIAN_THOUGHTS_CAPTURE"\)/);
  // AND ACTUALLY RENDERED. The flag is the only condition in front of it — a
  // workspace behind a second, always-false guard is a screen that still reads
  // as though the capability is there.
  const gate = src.indexOf("{notesAvailable && (");
  assert.ok(gate > 0, "the workspace is not rendered behind the capture flag");
  const region = src.slice(gate, src.indexOf("</Panel>", gate));
  assert.match(region, /<ThoughtsWorkspace/, "the flagged region does not render the workspace");
  assert.ok(!/\bfalse &&/.test(region), "the workspace sits behind a literal false");
});

test("the recorder shows which session before the clinician speaks", () => {
  // The same reason it shows the person's name: a wrong-session error is
  // caught here or not at all. Afterwards the note reads correctly and only
  // the heading above it is wrong.
  const src = read("components/clinical/ThoughtRecorder.tsx");
  const nameAt = src.indexOf("{personName}");
  const sessionAt = src.indexOf("sourceSession.label");
  assert.ok(sessionAt > 0, "the recorder never names the session");
  assert.ok(sessionAt > nameAt, "the session is named before the person");
  const controlsAt = src.indexOf('phase === "recording" ? "text-state-support"');
  assert.ok(sessionAt < controlsAt, "the session is named after the controls");
});

test("the typed door carries the session too", () => {
  // It was added after the recorder and is the one a reader forgets. A
  // clinician who cannot speak gets the same linkage or the feature has a hole
  // in exactly the situation it was widened for.
  const src = read("components/clinical/ThoughtWriter.tsx");
  assert.match(src, /name="sourceSessionId"/);
  assert.match(src, /sourceSession\.label/);
});

test("the note list says which session, and says when there is none", () => {
  const src = read("app/clinician/member/[id]/thoughts/page.tsx");
  assert.match(src, /Not attached to a session/);
  assert.match(src, /sessionLabels\.get\(t\.sourceSessionId\)/);
  // And its own date column is a day rather than a stored stamp. It rendered
  // "2026-09-04 00:00:00" — a midnight nothing happened at — in the same row
  // as the session line above.
  assert.ok(!/\{t\.recordedAt\}/.test(src), "the note list renders a raw timestamp");
  assert.match(src, /readableDay\(t\.recordedAt\)/);
});

test("the demo has a note attached to a session, so the linkage is on a screen", () => {
  // The standing rule on this project: work that is not on the screen is not
  // done. Without a seeded link, the Thoughts page's "About the …" line and
  // Session Prep's "from that session" wording are both reachable code that a
  // reviewer never sees.
  const seed = fs.readFileSync(path.join(SRC, "lib", "demo-thoughts-seed.ts"), "utf8");
  assert.match(seed, /UPDATE clinician_thoughts SET source_session_id = \? WHERE id = \?/);
  // Attached to the member's LATEST session and the NEWEST note, because that
  // is the pair Session Prep reads.
  assert.match(seed, /ORDER BY started_at DESC LIMIT 1/);
  assert.match(seed, /RECORDINGS\.reduce\(\(a, b\) => \(b\.day > a\.day \? b : a\)\)/);
});

test("the review loader is one implementation, not two", () => {
  // It re-authenticates and re-resolves the tenant for an id the BROWSER
  // sends. Two copies of that is two authorization checks that can diverge,
  // which is why the second caller extracted it rather than copying it.
  const shared = read("lib/clinical/thought-review-load.ts");
  assert.match(shared, /"use server"/);
  // The CALL, not the import. It re-authenticates on every invocation, which
  // is the whole reason this is a server action rather than a fetch — an
  // import with no call site type-checks and authorizes nothing.
  const body = shared.slice(shared.indexOf("export async function loadThoughtForReview"));
  assert.match(body, /await requireClinician\(\)/, "the loader does not re-authenticate");
  assert.match(body, /tenant_id FROM users WHERE id = \?/, "the loader does not re-resolve the tenant");
  for (const file of [
    "app/clinician/member/[id]/thoughts/page.tsx",
    "app/clinician/member/[id]/session/[sid]/page.tsx",
  ]) {
    const src = read(file);
    assert.match(src, /loadThoughtForReview/, `${file} does not use the shared loader`);
    assert.ok(
      !/async function loadTranscript/.test(src),
      `${file} still carries its own copy of the loader`
    );
  }
});
