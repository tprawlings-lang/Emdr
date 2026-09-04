// The task registry (ADR 0012 §2) — the unit of versioning.
//
// Before this existed, a prompt was a string literal inside the function that
// used it, a model was an environment variable read at that call site, and a
// change to either was invisible to everything downstream. B5 requires "every
// model, prompt, intervention, feature and scoring policy" to be versioned with
// golden sets and regression suites, and D5's Learning Ledger has to answer
// what Steady thought and why — neither is possible when the prompt has no
// identity.
//
// So a task is a record: id, version, model policy, output shape, tool
// allowlist, PHI posture and what happens when the model is unavailable. The
// prompt itself stays with the feature that owns the domain language; what
// lives here is its VERSION, because the registry's job is to make a change
// nameable, not to become the place all prose is written.

import { assertToolAllowed, type GatewayTool } from "./tiers";

/** What a task does with the answer when the model cannot be reached, or
 *  returns something the schema rejects. Every task must state one: a task with
 *  no fallback is a feature that breaks when the network does. */
export type FallbackKind =
  /** The caller has a deterministic answer already and keeps it. */
  | "deterministic"
  /** The caller cannot proceed and surfaces a stated limitation. */
  | "refuse";

/** Whether protected content may reach the model for this task, and in what
 *  form. §18: "AI gateway provenance may store protected input references and
 *  hashes rather than duplicating full PHI when not required." */
export type PhiPosture =
  /** Protected content is sent (a companion reply cannot work without it) and
   *  the provenance record stores a hash and references, never the text. */
  | "protected-in-hashed-provenance"
  /** No protected content is sent at all. */
  | "none";

export interface TaskDefinition {
  id: string;
  /** Bumped whenever the prompt, schema, model policy or tool set changes.
   *  Recorded on every inference, so a regression is attributable. */
  version: string;
  /** What it is for, in one line, for the audit reader. */
  purpose: string;
  model: string;
  maxTokens: number;
  thinking?: boolean;
  effort?: "low" | "medium" | "high";
  maxRetries?: number;
  phi: PhiPosture;
  fallback: FallbackKind;
  /** Tools this task may offer. Empty for every task that does not need one —
   *  which is most of them, and deliberately the default. */
  tools?: GatewayTool[];
  /** Turns of tool use before the loop closes. Only meaningful with tools. */
  maxToolTurns?: number;
}

const TASKS = new Map<string, TaskDefinition>();

export function registerTask(def: TaskDefinition): TaskDefinition {
  for (const tool of def.tools ?? []) assertToolAllowed(tool, def.id);
  if (TASKS.has(def.id) && TASKS.get(def.id)!.version !== def.version) {
    throw new Error(
      `Task ${def.id} is already registered at version ${TASKS.get(def.id)!.version}.`
    );
  }
  TASKS.set(def.id, def);
  return def;
}

export function getTask(id: string): TaskDefinition | undefined {
  return TASKS.get(id);
}

export function registeredTasks(): TaskDefinition[] {
  return [...TASKS.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// The tasks this product runs today
// ---------------------------------------------------------------------------
//
// Registered here rather than beside each feature so the complete set of ways
// this product can reach a model is readable in one place. That list is the
// thing a security reviewer asks for, and until now the honest answer was
// "grep for the SDK import".

export const COMPANION_REPLY = registerTask({
  id: "companion.reply",
  version: "1.0.0",
  purpose: "The member-facing companion conversation, with memory tools.",
  model: process.env.EMDR_COMPANION_MODEL ?? "claude-opus-4-8",
  maxTokens: 1024,
  thinking: true,
  effort: "low",
  maxRetries: 3,
  phi: "protected-in-hashed-provenance",
  fallback: "deterministic",
  maxToolTurns: 5,
});

export const PLAN_DRAFT = registerTask({
  id: "plan.draft",
  version: "1.0.0",
  purpose: "Drafts a member's working program plan under a JSON contract.",
  model: process.env.EMDR_PLAN_MODEL ?? "claude-opus-4-8",
  maxTokens: 2000,
  thinking: true,
  phi: "protected-in-hashed-provenance",
  fallback: "refuse",
});

export const THOUGHT_EXTRACT = registerTask({
  id: "clinician.thought.extract",
  version: "1.0.0",
  // §9's table, verbatim: "Turn transcript into candidate memory items",
  // output "strict JSON extraction object", human gate "all items reviewed
  // before approval". The gate is not enforceable from here — it is enforced by
  // candidates being written with status 'candidate' and only a clinician save
  // moving them — but the purpose line is what an audit reader sees, so it says
  // what the task is for rather than what it returns.
  purpose: "Turns a clinician's spoken thought into CANDIDATE memory items for review. Never writes to the record itself.",
  model: process.env.EMDR_EXTRACTION_MODEL ?? "claude-opus-4-8",
  maxTokens: 4000,
  thinking: true,
  effort: "medium",
  maxRetries: 2,
  phi: "protected-in-hashed-provenance",
  // REFUSE, not deterministic. There is no deterministic extraction to fall
  // back to: §8.1's state machine has a state for exactly this
  // ("review_transcript_only") and §17.4 has the copy for it — "Your transcript
  // is safe. Steady could not organize it yet." A fallback that invented items
  // when the model was unreachable would be the one failure this feature must
  // never have.
  fallback: "refuse",
});

export const THREAD_MATCH = registerTask({
  id: "clinician.thread.match",
  version: "1.0.0",
  // §9's table: "Rank existing thread candidates for approved item", output
  // "thread candidates with evidence and scores", human gate "connection
  // requires clinician action in v1".
  //
  // REGISTERED BUT NOT CALLED IN THIS DEPLOYMENT, and that is stated rather
  // than left to be discovered. §10's scoring is four parts arithmetic and one
  // part semantic similarity; there is no embedding index here, so the matcher
  // computes the four exactly and records which components it used. A model
  // call would be slower, non-reproducible, and would put a model's name on a
  // number a spreadsheet computes. The entry exists so a deployment that HAS
  // the index has the contract, and so the task's identity is versioned from
  // the start rather than invented later.
  purpose: "Ranks existing threads an approved memory item might belong to. Proposes only; a clinician connects.",
  model: process.env.EMDR_THREAD_MATCH_MODEL ?? "claude-opus-4-8",
  maxTokens: 1500,
  phi: "protected-in-hashed-provenance",
  // The deterministic matcher IS the fallback, and it is what runs today.
  fallback: "deterministic",
});

export const SESSION_PREP_COMPOSE = registerTask({
  id: "clinician.session_prep.compose",
  version: "1.0.0",
  // §9's table: "Create concise pre-session brief from authorized evidence",
  // output "sectioned prep with evidence IDs per claim", human gate "no fact
  // promotion, source drill-down required".
  //
  // OPTIONAL, AND THE BRIEF IS COMPLETE WITHOUT IT. §11 asks for generation
  // "mainly for concise wording and synthesis", not for the noticing — so the
  // assembler produces every section deterministically and this task, when a
  // deployment enables it, can only reword what the assembler already found and
  // already cited. It cannot introduce a claim, because the claim validator
  // runs after it against the same authorized evidence set and drops anything
  // that cites outside it.
  purpose: "Rewords an already-assembled, already-cited session brief. Cannot introduce a claim or a citation.",
  model: process.env.EMDR_SESSION_PREP_MODEL ?? "claude-opus-4-8",
  maxTokens: 1200,
  phi: "protected-in-hashed-provenance",
  // The deterministic brief IS the fallback, and it is what ships today.
  fallback: "deterministic",
});

// --- Return-to-Life goals (expansion handoff 01 §7). ---------------------
//
// Three tasks with three different hard boundaries, and the boundaries are the
// reason they are three entries rather than one "goals" task.

export const GOAL_DRAFT_LADDER = registerTask({
  id: "return_goal.draft_ladder",
  version: "1.0.0",
  // §7's boundary: "patient/clinician must review; do not choose goal or invent
  // baseline." The model turns a sentence a person said into five observable
  // rungs. It does not decide what matters to them, and it does not assert
  // where they currently are — §3: "baseline is descriptive, not a judgement",
  // and a model that guessed the baseline would be judging.
  purpose: "Turns a patient's own goal statement into five proposed observable levels. Never chooses the goal or the baseline.",
  model: process.env.EMDR_GOAL_LADDER_MODEL ?? "claude-opus-4-8",
  maxTokens: 900,
  phi: "protected-in-hashed-provenance",
  // Refuse: there is no deterministic way to write five observable rungs for an
  // arbitrary life goal, and inventing them would be the model choosing what
  // the person is aiming for.
  fallback: "refuse",
});

export const GOAL_MATCH_EVIDENCE = registerTask({
  id: "return_goal.match_evidence",
  version: "1.0.0",
  // §7's boundary: "proposes evidence only; no automatic level change."
  purpose: "Suggests authorized records that may relate to an active goal. Proposes only; a person accepts.",
  model: process.env.EMDR_GOAL_MATCH_MODEL ?? "claude-opus-4-8",
  maxTokens: 800,
  phi: "protected-in-hashed-provenance",
  // The deterministic matcher is the fallback and is what runs today.
  fallback: "deterministic",
});

export const GOAL_SUMMARIZE_PROGRESS = registerTask({
  id: "return_goal.summarize_progress",
  version: "1.0.0",
  // §7's boundary: "every statement cites accepted observation IDs." Enforced
  // after the fact by the claim validator, not by asking the model nicely.
  purpose: "Words progress that accepted observations already establish. Every statement cites observation ids.",
  model: process.env.EMDR_GOAL_SUMMARY_MODEL ?? "claude-opus-4-8",
  maxTokens: 600,
  phi: "protected-in-hashed-provenance",
  fallback: "deterministic",
});

export const SESSION_REPHRASE = registerTask({
  id: "session.rephrase",
  version: "1.0.0",
  // ONE task, not two. The web and mobile paths each carried their own copy of
  // this call — same model, same prompt builder, same guard — which is exactly
  // the drift the gateway exists to stop. They now share a registry entry, so a
  // change to either reaches both or neither.
  purpose: "Rewords an already-safe in-session line. Never composes a new one.",
  model: "claude-haiku-4-5-20251001",
  maxTokens: 160,
  maxRetries: 2,
  phi: "protected-in-hashed-provenance",
  fallback: "deterministic",
});

// --- Treatment Response Fingerprint (expansion handoff 02 §8). --------------
//
// Three tasks with three different hard boundaries, and §12's Phase 4
// definition of done is a single sentence about all of them: "AI cannot change
// statistics or causal semantics."
//
// The statistics are computed in response-fingerprint.ts from evidence rows,
// under a named policy version, and are reproducible by hand from the listed
// evidence. Nothing below is permitted to produce a number. That is not a
// prompt instruction — a prompt instruction is a request — it is a property of
// where the numbers come from: the summariser is handed an already-computed
// summary and every deployment that enables it keeps the deterministic text as
// the fallback, so the worst a model failure can do is leave the honest
// sentence in place.

export const RESPONSE_NORMALIZE_INTERVENTION = registerTask({
  id: "response.normalize_intervention",
  version: "1.0.0",
  // §8's boundary: allowed to "map clinician wording to candidate canonical
  // intervention"; not allowed to "auto-create clinical intervention identity
  // without review when ambiguous."
  //
  // CANDIDATE is the whole word. A canonical key is the thing every count in
  // this feature is grouped by, so a model that minted one would be deciding
  // what counts as the same intervention — and two things wrongly called the
  // same put a median over a mixture.
  purpose: "Suggests which canonical intervention a clinician's wording may mean. Proposes only; a clinician confirms.",
  model: process.env.EMDR_RESPONSE_NORMALIZE_MODEL ?? "claude-opus-4-8",
  maxTokens: 500,
  phi: "protected-in-hashed-provenance",
  // The deterministic normalizer — a slug of the clinician's own words — is the
  // fallback and is what runs today. It never merges two keys, which is the
  // conservative direction: a duplicate definition is a clinician's to merge,
  // and a wrong merge is evidence nobody can pull apart again.
  fallback: "deterministic",
});

export const RESPONSE_SUMMARIZE_PATTERN = registerTask({
  id: "response.summarize_pattern",
  version: "1.0.0",
  // §8's boundary: allowed to "render deterministic stats into concise language
  // with evidence IDs"; not allowed to "recalculate stats, invent causal
  // explanation, suppress adverse observations."
  //
  // ALL THREE OF THOSE ARE STRUCTURAL HERE, not asked for. It cannot recalculate
  // because it is handed the computed summary and the fallback is the
  // deterministic sentence. It cannot invent a causal explanation because §6's
  // five pattern states are the only vocabulary the surface renders, and they
  // are chosen by `patternStateFor` from counts. It cannot suppress an adverse
  // observation because the adverse counts are on the summary the caller
  // already has, and the screen prints them whether or not this task ran.
  purpose: "Words a pattern the projection already computed. Cannot compute a number, explain a cause, or drop an adverse observation.",
  model: process.env.EMDR_RESPONSE_SUMMARY_MODEL ?? "claude-opus-4-8",
  maxTokens: 700,
  phi: "protected-in-hashed-provenance",
  // The deterministic sentence IS the fallback, and it is what ships today.
  fallback: "deterministic",
});

export const RESPONSE_MATCH_CONTEXT = registerTask({
  id: "response.match_context",
  version: "1.0.0",
  // §8's boundary: allowed to "suggest thread/goal context related to an
  // instance"; not allowed to "assert that context caused response."
  //
  // Registered but not called in this deployment, on the same terms as
  // clinician.thread.match: the functional adapter attaches goal observations
  // by an explicit temporal window, which is reproducible and says exactly what
  // it did. The entry exists so the boundary is versioned from the start rather
  // than invented when someone enables it.
  purpose: "Suggests goal or thread context around one exposure. A suggestion about relatedness, never about cause.",
  model: process.env.EMDR_RESPONSE_CONTEXT_MODEL ?? "claude-opus-4-8",
  maxTokens: 600,
  phi: "protected-in-hashed-provenance",
  fallback: "deterministic",
});
