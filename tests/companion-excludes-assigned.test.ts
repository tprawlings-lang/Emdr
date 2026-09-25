// Clinician-assigned payloads are unreachable from the companion and from
// every model path (Handoff 10 §6 and §7: "Excluded from the companion
// completely: not in prompts, memory, tools, or summaries. Test asserts no
// companion code path can read clinician_assigned payloads." The handoff
// asked for this test before the lane existed, to guard it; the lane now
// exists, so it guards the real thing).
//
// Two layers:
//   1. No file that builds a companion reply, a prompt, a memory, a tool or
//      a model summary names the lane's tables, its module, or its readers.
//   2. The lane itself never writes to anything the companion reads: no
//      memory, no companion tables, nothing in the spine but coded facts.

import { strict as assert } from "node:assert";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "src/lib");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** What a model path must never name. */
const LANE = /\b(intervention_runs|intervention_run_responses|assigned-lane|h10-assigned-lane|laneRunsForClinician|myLaneRuns|laneRun|saveLaneStep|encrypted_free_text)\b/;

/** Every file that talks to a model or builds what a model reads: found, not
 *  listed by hand, so a new summariser is covered the day it arrives. */
function modelPathFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.ts$/.test(d.name)) {
        const src = fs.readFileSync(p, "utf8");
        const rel = path.relative(SRC, p);
        if (rel.startsWith("governance/") || rel.startsWith("app/") || rel.startsWith("site/")) continue; // registers and copy that describe, not call
        if (/@anthropic-ai\/sdk|from "\.{1,2}\/(?:\.\.\/)?ai-gateway|callModel\(/.test(src) || /^companion|^session-companion|^ai-gateway\//.test(rel)) out.push(rel);
      }
    }
  };
  walk(SRC);
  return out.sort();
}

test("the model paths are found, and they include the companion's", () => {
  const files = modelPathFiles();
  for (const f of ["companion-ai.ts", "companion-tools.ts", "companion.ts", "session-companion.ts", "ai-gateway/index.ts"]) {
    assert.ok(files.includes(f), `${f} is not being checked`);
  }
});

test("no companion, prompt, memory, tool or model-summary file can reach a clinician-assigned payload", () => {
  const hits = modelPathFiles().flatMap((f) => {
    const src = code(fs.readFileSync(path.join(SRC, f), "utf8"));
    return LANE.test(src) ? [`${f}: ${src.match(LANE)![0]}`] : [];
  });
  assert.deepEqual(hits, []);
});

test("the lane writes nothing the companion reads", () => {
  const lane = code(fs.readFileSync(path.join(SRC, "assigned-lane.ts"), "utf8"));
  // No memory, no companion tables, no companion module but the crisis check
  // (which runs over the words and keeps none of them).
  assert.doesNotMatch(lane, /writeMemory|companion_memories|companion_messages|companion_proposals|ai_companion/);
  const companionImports = [...lane.matchAll(/from "\.\/(companion[\w-]*)"/g)].map((m) => m[1]);
  assert.deepEqual(companionImports, [], "the lane imports a companion module directly");
  // The one shared piece is the pre-filter, reached through program-activities.
  assert.match(lane, /screenMemberText/);
});

test("the companion's tools cannot name a lane module", async () => {
  const { companionTools } = await import("../src/lib/companion-tools");
  const described = JSON.stringify(companionTools(true));
  for (const id of ["wet-v1", "cpt-worksheets-v1", "irt-nightmares-v1", "clinician_assigned"]) {
    assert.ok(!described.includes(id), `a companion tool mentions ${id}`);
  }
});
