// The AI Gateway (ADR 0012), and the invariant it exists to make structural.
//
// ADR 0012's whole argument is one sentence: the safety properties of this
// product's model calls held "per call site, by convention", and "a fifth call
// site added by someone who has not read the safety rules inherits none of it."
// That was not a prediction. When the gateway was built there were five — four
// named in the ADR plus a health-check route in `src/app/api/` that nobody
// thinks of as AI code — and two of the four were character-for-character
// identical copies running in the web and mobile paths.
//
// So the first test here is the one that matters most, and it is a source scan
// rather than a behaviour test: no module outside the provider boundary may
// import a model SDK. Everything else the gateway does is downstream of that
// import being impossible.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/lib/db";
import {
  invoke, registerTask, registeredTasks, getTask, setProvider,
  assertToolAllowed, ProhibitedToolError, PROHIBITED_CAPABILITIES,
  type ModelProvider, type ModelResponse, type GatewayTool,
} from "../src/lib/ai-gateway";

const root = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

/** Comments here discuss the SDK by name at length. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

const BOUNDARY = "src/lib/ai-gateway/provider.ts";

test("only the provider boundary may import a model SDK", () => {
  const offenders = walk("src")
    .filter((f) => f !== BOUNDARY)
    .filter((f) => /@anthropic-ai\/sdk|from ["']openai["']|@google\/gener/.test(code(fs.readFileSync(path.join(root, f), "utf8"))));
  assert.deepEqual(offenders, [],
    `these modules reach a model provider outside the gateway: ${offenders.join(", ")}`);
});

test("the boundary file is the one that does import it", () => {
  // The inverse, so the guard above cannot pass by the SDK having been removed
  // from the project entirely — a check that passes when the thing it guards
  // does not exist is not guarding anything.
  assert.match(fs.readFileSync(path.join(root, BOUNDARY), "utf8"), /@anthropic-ai\/sdk/);
});

test("every registered task states a version, a model, a PHI posture and a fallback", () => {
  const tasks = registeredTasks();
  assert.ok(tasks.length >= 3, "the tasks this product runs are not registered");
  for (const t of tasks) {
    assert.match(t.version, /^\d+\.\d+\.\d+$/, `${t.id} has no semantic version`);
    assert.ok(t.model.length > 0, `${t.id} names no model`);
    assert.ok(t.purpose.length > 10, `${t.id} does not say what it is for`);
    // B5 needs a version per task; D5's ledger needs to know what happens when
    // the model is unreachable. A task with no fallback is a feature that
    // breaks when the network does.
    assert.ok(["deterministic", "refuse"].includes(t.fallback), `${t.id} has no fallback`);
    assert.ok(["protected-in-hashed-provenance", "none"].includes(t.phi), `${t.id} has no PHI posture`);
  }
});

test("the web and mobile rephrase are ONE task", () => {
  // They were two identical call sites. A change to the safety behaviour of one
  // produced two different products, silently.
  const ids = registeredTasks().map((t) => t.id);
  assert.ok(ids.includes("session.rephrase"));
  assert.equal(ids.filter((id) => id.includes("rephrase")).length, 1,
    "there is more than one rephrase task again");
  for (const f of ["src/lib/actions.ts", "src/lib/mobile/voice.ts"]) {
    const src = code(fs.readFileSync(path.join(root, f), "utf8"));
    assert.match(src, /rephraseSessionLine\(/, `${f} does not use the shared rephrase`);
    assert.ok(!/buildSessionRephrasePrompt\(/.test(src),
      `${f} builds the rephrase prompt itself again`);
  }
});

test("an unregistered task cannot reach a model", () => {
  // Accepting one would let a feature call a provider with no version, no tool
  // policy and no fallback — the state the gateway exists to end.
  return assert.rejects(
    () => invoke({
      task: "not.registered",
      scope: { tenantId: "t", personId: "p", purpose: "x" },
      system: "s", messages: [{ role: "user", content: "hi" }],
    }),
    /Unregistered gateway task/
  );
});

test("a prohibited capability is refused at registration, not at the call", () => {
  // A6: "generative output cannot override a safety state." That held in this
  // codebase because nobody had defined such a tool — an invariant living in an
  // absence, which cannot refuse anything.
  for (const capability of PROHIBITED_CAPABILITIES) {
    const tool: GatewayTool = {
      name: "x", description: "d", inputSchema: {}, tier: "write-soft", capability,
    };
    assert.throws(() => assertToolAllowed(tool, "some.task"), ProhibitedToolError,
      `capability "${capability}" was accepted`);
  }
  // And by tier, so a renamed capability is not a way through.
  assert.throws(
    () => assertToolAllowed(
      { name: "x", description: "d", inputSchema: {}, tier: "prohibited", capability: "harmless_sounding" },
      "some.task"),
    ProhibitedToolError);
  // Registration is where it fails, so the build breaks rather than a request.
  assert.throws(() => registerTask({
    id: "test.prohibited", version: "1.0.0", purpose: "a test of the tier check",
    model: "m", maxTokens: 10, phi: "none", fallback: "refuse",
    tools: [{ name: "clear", description: "d", inputSchema: {}, tier: "write-soft", capability: "clear_safety_state" }],
  }), ProhibitedToolError);
  assert.equal(getTask("test.prohibited"), undefined, "the refused task was registered anyway");
});

// ── Behaviour, against a fake provider ──────────────────────────────────────

function fakeProvider(responses: Partial<ModelResponse>[]): ModelProvider {
  let i = 0;
  return {
    id: "fake",
    async complete() {
      const r = responses[Math.min(i++, responses.length - 1)];
      return {
        text: "", toolUses: [], stopReason: "end_turn", model: "fake-1",
        usage: { inputTokens: 1, outputTokens: 1 }, content: [], ...r,
      };
    },
  };
}

const SCOPE = { tenantId: "t1", personId: "p1", purpose: "test" };

// The gateway refuses to send content it cannot attribute — a scope naming a
// person who does not exist is a bug in the calling feature, not a reason to
// call a provider. These tests are about tool allowlists, loop ceilings and
// provider errors, so they need a person to exist before any of that is
// reachable. Fabricated, because nothing here is about a real participant and
// a fabricated person carries no terms to check.
function ensureScopePerson() {
  const db = getDb();
  db.prepare(
    "INSERT INTO tenants (id, kind, name) VALUES (?, 'program', 'Gateway test') ON CONFLICT(id) DO NOTHING",
  ).run(SCOPE.tenantId);
  db.prepare(
    `INSERT INTO persons (id, tenant_id, display_name, provenance)
     VALUES (?, ?, 'Gateway test person', 'fabricated') ON CONFLICT(id) DO NOTHING`,
  ).run(SCOPE.personId, SCOPE.tenantId);
}
ensureScopePerson();

test("a task's allowlist is the authority, not the caller's argument", async () => {
  registerTask({
    id: "test.tools", version: "1.0.0", purpose: "a test of the tool allowlist",
    model: "m", maxTokens: 10, phi: "none", fallback: "deterministic",
    maxToolTurns: 3,
    tools: [{ name: "allowed", description: "d", inputSchema: {}, tier: "read", capability: "read_thing" }],
  });
  process.env.ANTHROPIC_API_KEY = "test-key";
  const restore = setProvider(fakeProvider([
    { toolUses: [{ id: "u1", name: "sneaky", input: {} }], stopReason: "tool_use" },
    { text: "done", stopReason: "end_turn" },
  ]));
  const executed: string[] = [];
  try {
    const r = await invoke({
      task: "test.tools", scope: SCOPE, system: "s",
      messages: [{ role: "user", content: "hi" }],
      // A tool the registry does not name. Passing it must not be a way to
      // offer it: the registry is the authority.
      tools: [
        { name: "allowed", description: "d", inputSchema: {}, tier: "read", capability: "read_thing" },
        { name: "sneaky", description: "d", inputSchema: {}, tier: "write-soft", capability: "do_anything" },
      ],
      executeTool: async (use) => { executed.push(use.name); return "ok"; },
    });
    assert.equal(r.outcome, "answered");
    assert.deepEqual(executed, [],
      `an unlisted tool was executed: ${executed.join(", ")}`);
  } finally { restore(); }
});

test("the tool loop has a ceiling and reports hitting it", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const restore = setProvider(fakeProvider([
    // Always asks for a tool: without a ceiling this never returns.
    { toolUses: [{ id: "u", name: "allowed", input: {} }], stopReason: "tool_use" },
  ]));
  try {
    const r = await invoke({
      task: "test.tools", scope: SCOPE, system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "allowed", description: "d", inputSchema: {}, tier: "read", capability: "read_thing" }],
      executeTool: async () => "ok",
    });
    assert.equal(r.outcome, "failed");
    assert.match(r.reason, /ceiling/);
    assert.equal(r.text, "", "a failed call returned text a caller might render");
  } finally { restore(); }
});

test("an absent provider is 'unavailable', not an error", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r = await invoke({
      task: "test.tools", scope: SCOPE, system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    // Every task has a fallback, so no provider is a routing fact rather than a
    // failure — and the two are distinguishable, which is what lets a caller
    // tell "the model is off" from "the model broke".
    assert.equal(r.outcome, "unavailable");
    assert.equal(r.text, "");
  } finally { if (key) process.env.ANTHROPIC_API_KEY = key; }
});

test("a provider that throws does not throw at the caller", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const restore = setProvider({
    id: "broken",
    async complete() { throw new Error("upstream exploded"); },
  });
  try {
    const r = await invoke({
      task: "test.tools", scope: SCOPE, system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.outcome, "failed");
    assert.match(r.reason, /upstream exploded/);
  } finally { restore(); }
});

test("a caller cannot render a non-answer by accident", async () => {
  // Every non-answering outcome returns an empty string, so the worst a caller
  // that forgets to check `outcome` can do is render nothing. The alternative —
  // a fallback sentence in `text` — would let a gateway failure reach a member
  // looking exactly like a model reply.
  process.env.ANTHROPIC_API_KEY = "test-key";
  const restore = setProvider({ id: "broken", async complete() { throw new Error("x"); } });
  try {
    const r = await invoke({
      task: "test.tools", scope: SCOPE, system: "s", messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.text, "");
    assert.equal(r.model, null);
    assert.equal(r.inferenceId, null);
  } finally { restore(); }
});

// ── The egress gate: whose words are about to leave ─────────────────────────

test("a real participant on the earlier notice never reaches the provider", async () => {
  // THE POINT OF THE GATE, asserted against a provider that would answer.
  // Being on the older notice must cost a model-written reply and nothing
  // else: the call comes back UNAVAILABLE, which is the path the caller
  // already has for a missing API key, so the companion falls to its
  // deterministic rules engine instead of failing in front of somebody
  // mid-sentence.
  const db = getDb();
  const {
    PILOT_TERMS_V1, PILOT_TERMS_V2, PILOT_ACK_SCOPE,
  } = await import("../src/lib/enrollment/pilot-terms");

  // The user row first: `consents.user_id` references it, and a person alone
  // is not an account.
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, status, tenant_id)
     VALUES ('gw-real', 'gw-real@example.test', 'Real participant', 'member', 'x', 'active', ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(SCOPE.tenantId);
  db.prepare(
    `INSERT INTO persons (id, tenant_id, display_name, provenance)
     VALUES ('gw-real', ?, 'Real participant', 'real') ON CONFLICT(id) DO NOTHING`,
  ).run(SCOPE.tenantId);
  db.prepare("DELETE FROM consents WHERE user_id = 'gw-real'").run();
  db.prepare(
    "INSERT INTO consents (id, user_id, policy_version, scope) VALUES ('gw-c1', 'gw-real', ?, ?)",
  ).run(PILOT_TERMS_V1, PILOT_ACK_SCOPE);

  registerTask({
    id: "test.egress", version: "1.0.0", purpose: "a test of the egress gate",
    model: "m", maxTokens: 10, phi: "none", fallback: "deterministic",
  });
  process.env.ANTHROPIC_API_KEY = "test-key";

  let calls = 0;
  const restore = setProvider({
    id: "counting",
    async complete() {
      calls++;
      return { text: "leaked", toolUses: [], stopReason: "end_turn", model: "fake-1",
               usage: { inputTokens: 1, outputTokens: 1 }, content: [] };
    },
  });
  try {
    const refused = await invoke({
      task: "test.egress", scope: { ...SCOPE, personId: "gw-real" }, system: "s",
      messages: [{ role: "user", content: "something they would not want sent" }],
    });
    assert.equal(refused.outcome, "unavailable", "content left for somebody on the earlier notice");
    assert.equal(calls, 0, "the provider was called at all, so the words had already left");

    // And once they accept, the same call goes through — the gate is a
    // consequence of their answer, not a permanent block on them.
    db.prepare(
      "INSERT INTO consents (id, user_id, policy_version, scope) VALUES ('gw-c2', 'gw-real', ?, ?)",
    ).run(PILOT_TERMS_V2, PILOT_ACK_SCOPE);
    const allowed = await invoke({
      task: "test.egress", scope: { ...SCOPE, personId: "gw-real" }, system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(allowed.outcome, "answered", "accepting the current notice did not restore the companion");
    assert.equal(calls, 1);
  } finally { restore(); }
});

test("a scope naming nobody is refused, and says so in its own words", async () => {
  // Distinct from the refusal above: this one is a bug in the calling feature,
  // not somebody exercising a choice, and one message for both would send
  // whoever debugs it hunting a consent record that was never the issue.
  registerTask({
    id: "test.noperson", version: "1.0.0", purpose: "a test of the attribution check",
    model: "m", maxTokens: 10, phi: "none", fallback: "deterministic",
  });
  process.env.ANTHROPIC_API_KEY = "test-key";
  let calls = 0;
  const restore = setProvider({
    id: "counting",
    async complete() {
      calls++;
      return { text: "", toolUses: [], stopReason: "end_turn", model: "fake-1",
               usage: { inputTokens: 1, outputTokens: 1 }, content: [] };
    },
  });
  try {
    const r = await invoke({
      task: "test.noperson", scope: { ...SCOPE, personId: "gw-nobody" }, system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(r.outcome, "unavailable");
    assert.equal(calls, 0, "content was sent for a person the system cannot identify");
  } finally { restore(); }
});
