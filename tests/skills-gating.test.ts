// Skills are gated in the listing, not the UI (Handoff 10 §3.1, 1A acceptance).
//
//   - A member at GROUNDING_ONLY sees only the grounding skills.
//   - Unknown activation sees only skills whose ceiling is 10
//     (KB_UNKNOWN_STATE_CONSERVATIVE).
//   - A deep link to a gated skill returns the "not today" state, not a 404.
//   - The practices that predate gating behave exactly as before.

process.env.EMDR_DATA_DIR = `/tmp/steady-skills-gating-${process.pid}-${Date.now()}`;
process.env.EMDR_SESSION_SECRET = "skills-gating-secret-at-least-32-chars-long";
process.env.EMDR_DATA_KEY = process.env.EMDR_DATA_KEY ?? "skills-gating-key";

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { getDb, newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { AccessTier } from "../src/lib/safety/types";
import {
  ALL_PRACTICES, BREATHWORK, MEDITATIONS, SLEEP, MOVEMENT, SKILLS, isGated, listPractices,
  practiceAllowed, practiceForMember, recordPracticeCompletion, type Practice, type PracticeGate,
} from "../src/lib/practices";

const db = getDb();

const skill = (id: string, over: Partial<Practice>): Practice => ({
  id, type: "skill", title: id, intro: "x", durationSec: 60, intensity: 1, tags: [], hasHold: false,
  steps: [{ text: "Notice your feet on the floor." }], ...over,
});

const grounding = skill("fx-grounding", { minTier: AccessTier.GROUNDING_ONLY, maxActivation: 8 });
const orientation = skill("fx-orientation", { minTier: AccessTier.GROUNDING_ONLY, maxActivation: 10 });
const stabilizing = skill("fx-stabilizing", { minTier: AccessTier.STABILIZATION, maxActivation: 6 });
const imagery = skill("fx-imagery", { minTier: AccessTier.GROUNDING_ONLY, maxActivation: 8, imagery: true });
const all = [grounding, orientation, stabilizing, imagery];
const allowed = (gate: PracticeGate | null) => all.filter((p) => practiceAllowed(p, gate)).map((p) => p.id);

test("at grounding-only, only the grounding skills", () => {
  assert.deepEqual(allowed({ tier: AccessTier.GROUNDING_ONLY, activation: 3, imagery: true }), ["fx-grounding", "fx-orientation", "fx-imagery"]);
});

test("activation above a ceiling closes that skill", () => {
  assert.deepEqual(allowed({ tier: AccessTier.STEADY, activation: 9, imagery: true }), ["fx-orientation"]);
});

test("unknown activation is treated as 10", () => {
  assert.deepEqual(allowed({ tier: AccessTier.STEADY, activation: null, imagery: true }), ["fx-orientation"]);
});

test("imagery needs the engine's imagery capability", () => {
  assert.ok(!allowed({ tier: AccessTier.STEADY, activation: 2, imagery: false }).includes("fx-imagery"));
});

test("an engine that cannot be read opens nothing gated, and changes nothing ungated", () => {
  assert.deepEqual(allowed(null), []);
  for (const p of [...BREATHWORK, ...MEDITATIONS, ...SLEEP, ...MOVEMENT]) {
    assert.equal(isGated(p), false, `${p.id} gained gating — backfilling is a separate clinical review`);
    assert.equal(practiceAllowed(p, null), true);
  }
});

test("every skill declares its gate", () => {
  // Required for skills and all new content (§3.1). SKILLS is empty until the
  // content pack lands; this holds each one to it as it arrives.
  for (const s of SKILLS) {
    assert.ok(s.minTier !== undefined && s.maxActivation !== undefined && s.imagery !== undefined, `${s.id} is missing a gate`);
    assert.ok(s.signoffRowIds && s.signoffRowIds.length > 0, `${s.id} has no sign-off row`);
    assert.ok(s.steps && s.steps.length > 0, `${s.id} has no steps`);
  }
});

function member(): string {
  const id = newId();
  db.prepare("INSERT INTO persons (id, tenant_id, display_name, provenance) VALUES (?, ?, 'M', 'fabricated')").run(id, PLATFORM_TENANT_ID);
  db.prepare("INSERT INTO users (id, tenant_id, email, password_hash, role, name) VALUES (?, ?, ?, 'x', 'member', 'M')")
    .run(id, PLATFORM_TENANT_ID, `${id}@skills.test`);
  return id;
}

test("through the listing and a deep link, for a member with no check-in today", async () => {
  // No check-in: activation is unknown, so only a ceiling of 10 opens.
  ALL_PRACTICES.push(grounding, orientation);
  try {
    const m = member();
    const listed = (await listPractices(m, "skill")).map((p) => p.id);
    assert.ok(!listed.includes("fx-grounding"), "a ceiling-8 skill was listed with activation unknown");
    assert.ok(listed.includes("fx-orientation"), "the ceiling-10 skill was dropped — is the gate reading at all?");
    assert.deepEqual(await practiceForMember(m, "fx-grounding"), { state: "not_today", title: "fx-grounding" });
    assert.equal((await practiceForMember(m, "nope")).state, "absent");
    // Existing practices are untouched by the gate.
    assert.equal((await listPractices(m, "breathwork")).length, BREATHWORK.length);
  } finally {
    for (const p of [grounding, orientation]) ALL_PRACTICES.splice(ALL_PRACTICES.indexOf(p), 1);
  }
});

test("an unsigned skill cannot be recorded as completed", async () => {
  const unsigned = skill("fx-unsigned", { signoffRowIds: ["CV10_E05"], minTier: 1, maxActivation: 10, imagery: false });
  ALL_PRACTICES.push(unsigned);
  try {
    assert.deepEqual(await recordPracticeCompletion(member(), "fx-unsigned", 30), { ok: false });
  } finally {
    ALL_PRACTICES.splice(ALL_PRACTICES.indexOf(unsigned), 1);
  }
});

test("Stop is one tap, and the skill page asks the gate itself", () => {
  const player = fs.readFileSync(path.join(process.cwd(), "src/components/SkillPlayer.tsx"), "utf8");
  assert.doesNotMatch(player, /confirm\(|are you sure/i, "stopping asks for confirmation");
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/app/activities/skills/[skillId]/page.tsx"), "utf8");
  assert.match(page, /practiceForMember\(/);
  assert.match(page, /state === "not_today"/);
});
