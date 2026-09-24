// The companion's tools cannot write session state (Expansion Handoff,
// non-negotiable 5, §5.3; Phase 0).
//
//   "Tools cannot write session state. This is an open audit finding. New tools
//   get read-only access and communicate through events."
//
//   "[The Tool Runtime] has no import path to the state writer; enforce with a
//   lint rule and a dependency test."
//
// Phase 0's definition of done is that the finding "has a regression test in CI
// that fails if the gap reopens." This is that test, and it was written to FAIL
// against the code as it stood — the proof that it tests the gap and not the
// shape of a fix.
//
// WHAT THE GAP ACTUALLY WAS, which is worse than the handoff's sentence. The
// companion's `record_trigger` tool wrote `user_triggers` directly, including
// `intensity_score` through a COALESCE that takes any new value. That number is
// the only thing keeping a trigger out of SELF-GUIDED processing: the
// `recent-trigger` module disables anything at 7 or above with "bring this one
// to your specialist". So a model could take a trigger a person rated 8 and set
// it to 3, and it became something they could process on their own. That is a
// model LOWERING a protection, which non-negotiable 2 forbids outright: "A
// model may only add a flag for human review, never remove one."
//
// NOT LIVE IN THIS DEPLOYMENT, and that needs saying as precisely as the harm.
// Model-backed replies run only when ANTHROPIC_API_KEY is set, and it is unset
// by decision (`companion.model-backed-replies` is held). The tools were
// reachable the moment that changed.

process.env.EMDR_DATA_DIR = `/tmp/steady-companion-boundary-${process.pid}-${Date.now()}`;
process.env.EMDR_DEMO = "1";
process.env.EMDR_SESSION_SECRET = "companion-boundary-secret-at-least-32-chars";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "companion-boundary-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { executeCompanionTool } from "../src/lib/companion-tools";
import {
  pendingProposals, acceptTriggerProposal, dismissProposal, writeModelMemory, ProposalRefused,
} from "../src/lib/companion-proposals";
import { getSessionFocus } from "../src/lib/session-focus";
import {
  SESSION_STATE_TABLES, SESSION_TARGET_MEMORY_TYPES,
} from "../src/lib/governance/session-state";

const SRC = path.join(process.cwd(), "src/lib");
const RUNTIME = fs.readFileSync(path.join(SRC, "companion-tools.ts"), "utf8");
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const db = getDb();
function member(name: string): string {
  const id = newId();
  db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, ?, 'fabricated')"
  ).run(id, PLATFORM_TENANT_ID, name);
  db.prepare(
    "INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', ?)"
  ).run(id, PLATFORM_TENANT_ID, `${id}@boundary.test`, name);
  return id;
}

/** What the person could pick for a self-guided trigger session right now. */
async function selectableForSelfGuided(userId: string): Promise<string[]> {
  const focus = await getSessionFocus(userId, "recent-trigger");
  return (focus?.options ?? []).filter((o) => !o.disabled).map((o) => o.label);
}

/** What the person could pick as a focus in a processing module. */
async function focusTargets(userId: string): Promise<string[]> {
  const focus = await getSessionFocus(userId, "relational");
  return (focus?.options ?? []).map((o) => o.label);
}

const run = (userId: string, name: string, input: Record<string, unknown>) =>
  executeCompanionTool(userId, "conversation-under-test", name, input, { riskFlag: false });

// ---------------------------------------------------------------------------
// The dependency boundary
// ---------------------------------------------------------------------------

/**
 * Exactly what the tool runtime may import, BY SYMBOL.
 *
 * NO RAW DATABASE HANDLE, and that is the whole point: with `data` or `db` in
 * reach the runtime can issue any SQL it likes and the boundary is a
 * convention. And by symbol rather than by module, because the modules it may
 * import also export things it must not call — `writeMemory` stores any type
 * including a session target, and `acceptTriggerProposal` would be a model
 * confirming its own suggestion. Path-level would pass both.
 */
const RUNTIME_MAY_IMPORT: Record<string, readonly string[]> = {
  "./companion": ["MemoryType", "memoryEnabled"],
  "./companion-proposals": ["proposeToMember", "writeModelMemory"],
  "./ai-gateway": ["GatewayTool"],
};

function importsOf(src: string): Array<{ from: string; names: string[] }> {
  return [...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map((m) => ({
    from: m[2],
    names: m[1].split(",").map((n) => n.replace(/\btype\b/, "").trim()).filter(Boolean),
  }));
}

test("the tool runtime has no import path to a database handle", () => {
  // Any import form the parser below does not understand is itself a failure:
  // a default or namespace import would carry every export past the allow-list.
  const allImportLines = [...RUNTIME.matchAll(/^import .*$/gm)].map((m) => m[0]);
  const parsed = importsOf(RUNTIME);
  assert.equal(parsed.length, allImportLines.length,
    `an import the boundary check cannot read: ${allImportLines.join(" / ")}`);

  const stray: string[] = [];
  for (const { from, names } of parsed) {
    const allowed = RUNTIME_MAY_IMPORT[from];
    if (!allowed) { stray.push(`${from} (whole module)`); continue; }
    for (const n of names) if (!allowed.includes(n)) stray.push(`${n} from ${from}`);
  }
  assert.deepEqual(
    stray, [],
    "the companion's tool runtime imports something outside its boundary. If it reaches a " +
    "database handle or an unguarded writer it can write session state, whatever the tools are named."
  );
});

test("the tool runtime issues no write against a session-state table", () => {
  // The tripwire for a NEW tool. The behavioural tests below cover the tools
  // that exist; this catches the next one before it is ever called.
  const body = code(RUNTIME);
  const hits = SESSION_STATE_TABLES.filter((t) =>
    new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${t}\\b`, "i").test(body)
  );
  assert.deepEqual(hits, [], `the companion's tools write session state: ${hits.join(", ")}`);
});

// ---------------------------------------------------------------------------
// What a model can and cannot change about a person's sessions
// ---------------------------------------------------------------------------

test("a model cannot lower a trigger into self-guided processing", async () => {
  // THE ONE THAT MATTERS. The person rated this 8: it is specialist work.
  const person = member("Rosa");
  db.prepare(
    `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, intensity_score)
     VALUES (?, ?, 'Raised voices', 'relational', 8)`
  ).run(newId(), person);
  assert.ok(!(await selectableForSelfGuided(person)).includes("Raised voices"),
    "the fixture is already selectable, so this proves nothing");

  await run(person, "record_trigger", {
    trigger_name: "Raised voices", trigger_category: "relational", intensity_score: 3,
  });

  const row = db.prepare(
    "SELECT intensity_score FROM user_triggers WHERE user_id = ? AND trigger_name = 'Raised voices'"
  ).get(person) as { intensity_score: number };
  assert.equal(row.intensity_score, 8, "a model changed the intensity a person gave their own trigger");
  assert.ok(
    !(await selectableForSelfGuided(person)).includes("Raised voices"),
    "a trigger the person marked as specialist work became selectable for self-guided processing"
  );
});

test("a model cannot add a target a person could process on their own", async () => {
  const person = member("Sam");
  await run(person, "record_trigger", {
    trigger_name: "The smell of the hospital", trigger_category: "environmental", intensity_score: 2,
  });
  assert.ok(
    !(await selectableForSelfGuided(person)).includes("The smell of the hospital"),
    "something a model wrote down became a target for self-guided processing without the " +
    "person ever choosing it"
  );
});

test("a model cannot add a focus for a processing session", async () => {
  const person = member("Ada");
  const types = SESSION_TARGET_MEMORY_TYPES as readonly string[];
  assert.ok(types.includes("focus_area"), "the fixture's memory type is not a session target");

  await run(person, "remember", {
    memory_type: "focus_area", key: "my father", value: "Wants to work on what happened with their father.",
  });
  assert.ok(
    !(await focusTargets(person)).includes("my father"),
    "a model-written focus area appeared as something to work on in a processing session"
  );
});

test("a model may still add protection", async () => {
  // THE ASYMMETRY IS THE RULE, not an exception to it. A topic to avoid only
  // narrows what the companion will raise; refusing it would make the boundary
  // cost safety rather than protect it.
  const person = member("Bea");
  const reply = await run(person, "remember", {
    memory_type: "restricted_topic", key: "the accident", value: "Does not want the accident raised.",
  });
  assert.match(reply, /Remembered/, "a model could not record a topic to avoid");
});

// ---------------------------------------------------------------------------
// A number nobody gave fails closed
// ---------------------------------------------------------------------------

test("a trigger nobody has rated is not offered for self-guided work", async () => {
  // §0.3: "every numeric parameter... must cite a published source... or be
  // declared null and fail closed." The self-guided picker did the opposite:
  // it disabled a trigger only when `intensity_score !== null && >= 7`, so an
  // unrated trigger — from onboarding a person skipped, or from anywhere — was
  // selectable. `recent-trigger` asks for "a recent, low-to-medium trigger",
  // and a trigger nobody has rated cannot be known to be either.
  const person = member("Kofi");
  db.prepare(
    `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, intensity_score)
     VALUES (?, ?, 'Crowded trains', 'environmental', NULL)`
  ).run(newId(), person);

  const focus = await getSessionFocus(person, "recent-trigger");
  const option = focus?.options.find((o) => o.label === "Crowded trains");
  assert.ok(option, "the unrated trigger is not shown at all — it should be visible and unavailable");
  assert.equal(option!.disabled, true, "an unrated trigger is selectable for self-guided processing");
  assert.match(option!.disabledReason ?? "", /rate|how intense/i,
    "the reason does not tell the person what would make it available");
});

// ---------------------------------------------------------------------------
// The suggestion reaches the person, and only the person settles it
// ---------------------------------------------------------------------------

test("what the companion noticed is waiting for the person, not lost", async () => {
  // A boundary that refused silently would make the feature disappear. The
  // companion's observation is kept — as a suggestion, with no intensity.
  const person = member("Idris");
  await run(person, "record_trigger", {
    trigger_name: "Doors slamming", trigger_category: "environmental",
    intensity_score: 2, notes: "Startles at the front door at night.",
  });
  const waiting = await pendingProposals(person);
  assert.equal(waiting.length, 1, "the companion's observation was not kept for the person to see");
  assert.equal(waiting[0].title, "Doors slamming");
  assert.match(waiting[0].detail ?? "", /front door/, "the person's own words were lost on the way");
  assert.ok(!("intensity" in waiting[0]), "a suggestion carries an intensity the model chose");
});

test("the same observation twice is one suggestion, not two", async () => {
  // The title is encrypted with a random IV, so a SQL equality check on it can
  // never match. This is the test that would have caught that.
  const person = member("Noor");
  for (let i = 0; i < 3; i++) {
    await run(person, "record_trigger", { trigger_name: "Sirens", trigger_category: "environmental" });
  }
  assert.equal((await pendingProposals(person)).length, 1,
    "three mentions of one trigger produced more than one card for the person to deal with");
});

test("accepting a trigger requires the person's own rating, and then it counts", async () => {
  const person = member("Elias");
  await run(person, "record_trigger", { trigger_name: "Hospital corridors", trigger_category: "environmental" });
  const [p] = await pendingProposals(person);

  await assert.rejects(() => acceptTriggerProposal(person, p.id, Number.NaN),
    (e: Error) => e instanceof ProposalRefused, "a trigger was added with no intensity at all");

  await acceptTriggerProposal(person, p.id, 4);
  assert.ok((await selectableForSelfGuided(person)).includes("Hospital corridors"),
    "a trigger the person added and rated low-to-medium is not available to them");
  assert.equal((await pendingProposals(person)).length, 0, "the accepted suggestion is still waiting");
});

test("nobody else can settle a person's suggestion", async () => {
  const owner = member("Freya");
  const other = member("Tobias");
  await run(owner, "record_trigger", { trigger_name: "Loud bars", trigger_category: "environmental" });
  const [p] = await pendingProposals(owner);
  await assert.rejects(() => acceptTriggerProposal(other, p.id, 3),
    (e: Error) => e instanceof ProposalRefused, "one member accepted another member's suggestion");
  await assert.rejects(() => dismissProposal(other, p.id),
    (e: Error) => e instanceof ProposalRefused, "one member dismissed another member's suggestion");
  assert.equal((await pendingProposals(owner)).length, 1);
});

test("the guarded writer refuses a session target even if a new tool forgets", async () => {
  // THE SECOND LAYER. The import allow-list stops the runtime reaching the
  // unguarded writer; this stops the guarded one being used to do the same
  // thing, so a tool added next year cannot choose somebody's session focus by
  // calling the one writer it is allowed.
  const person = member("Mara");
  await assert.rejects(
    () => writeModelMemory({ userId: person, type: "focus_area", key: "k", value: "v", sourceId: "c" }),
    /may not write "focus_area"/,
  );
});
