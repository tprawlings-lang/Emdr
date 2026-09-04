import crypto from "node:crypto";

// Session Prep (§11, Phase 4).
//
// What a clinician reads in the minute before a session. §11 caps it there:
// "keep Session Prep short enough to scan in about one minute", which is a
// constraint on the whole design rather than a note about the layout — every
// section here has to earn its place against the sixty seconds.
//
// FOUR SECTIONS ARE DETERMINISTIC, ONE IS NOT, AND THEY ARE NOT MIXED.
// §11: "the first four sections should be mostly deterministic where data
// allows. Use generation mainly for concise wording and synthesis." So Last
// Session, You Wanted to Revisit, Between-Visit Changes and Active Threads are
// assembled from records — no model is consulted for them and none can be. Only
// Steady Noticed is machine-derived, it is labelled as such, and every item in
// it carries a Why am I seeing this that opens the evidence.
//
// EVERY CLAIM CITES, AND AN UNCITED CLAIM IS WITHHELD. Phase 4's third line of
// done. The validator is deliberately separate from the assembly and suspicious
// of it — the same posture summary.ts takes, and for the same reason: the
// contract has to hold for a model-composed section exactly as it holds for a
// deterministic one, and the only way to be sure is to check the output rather
// than trust the producer. A claim that cannot cite is dropped and the drop is
// reported, because a suppressed claim is a signal about the generator and
// hiding it would hide a defect.
//
// NO FACT PROMOTION. §9's human gate for the compose task. A hypothesis that
// reaches this brief is rendered as a hypothesis; nothing here can restate it
// as an observation, because every claim carries the statement class of the
// item it came from and the renderer reads that rather than the sentence.

import { activePolicy, CLINICAL_POLICY_VERSION, type ClinicalPolicy } from "../clinical-policy";
import { memberTimeline, type Timeline, type TimelineEntry } from "./timeline";
import { approvedMemory, type MemoryItem } from "./memory-store";
import { listThreads, membershipsForPerson, buildTimelines, type Thread } from "./thread-store";
import { itemsByIds } from "./memory-store";
import { openFollowUps, type FollowUp } from "./followups";
import { goalContextFor, goalLine, type GoalContext } from "./return-goal-evidence";
import { listThoughts, currentTranscript } from "./thought-store";
import { RETRIEVAL_POLICY_VERSION } from "./retrieval-policy";
import { responseContextFor, type ResponseContext } from "./response-fingerprint";
import { RESPONSE_POLICY } from "./response-fingerprint-policy";
import type { TenantContext } from "../repository";

export const SESSION_PREP_VERSION = "session-prep.1.0.0";

/** §11's five sections, in §11's order. */
export type PrepSection =
  | "last_session"
  | "life_goals"
  | "observed_responses"
  | "revisit"
  | "between_visit"
  | "active_threads"
  | "steady_noticed";

export const SECTION_TITLE: Record<PrepSection, string> = {
  last_session: "Last session",
  // Added by expansion handoff 01 §9, which asks Session Prep for a "Life
  // goals" section showing what moved, stalled, or has new evidence since the
  // last encounter. A sixth section against §11's five: the later handoff
  // controls, and it sits second because what a person can do again is the
  // thing the session is for.
  life_goals: "Life goals",
  // Added by expansion handoff 02 §9, which asks Session Prep for "what has
  // tended to help / what to watch, using observed pattern language and
  // evidence". Third, after the goals: the goals say what the session is for,
  // and this says what has and has not tended to follow the work.
  observed_responses: "What has tended to settle them, and what to watch",
  revisit: "You wanted to revisit",
  between_visit: "Between-visit changes",
  active_threads: "Active threads",
  steady_noticed: "Steady noticed",
};

export interface PrepClaim {
  section: PrepSection;
  text: string;
  /** Ledger event ids and memory item ids. Empty is invalid and dropped. */
  citations: string[];
  /** Assembled from records, or composed. Rendered differently on purpose:
   *  §11 requires Steady Noticed to be "explicitly machine-created", and a
   *  reader who cannot tell which is which has to trust both equally. */
  origin: "deterministic" | "generated";
  /** The statement class of the memory item behind this claim, when there is
   *  one. Carried so the renderer shows a hypothesis AS a hypothesis rather
   *  than restating it — §9's "no fact promotion", enforced by the data
   *  travelling rather than by the wording being careful. */
  statementClass?: string;
  /** §11: "every item gets a Why am I seeing this? action that opens
   *  evidence." Required for machine-derived items. */
  why?: string;
}

export interface SessionPrep {
  personId: string;
  sections: Record<PrepSection, PrepClaim[]>;
  /** Claims produced and refused, with the reason. Surfaced rather than
   *  swallowed. */
  omitted: { text: string; reason: string }[];
  /** Nothing after this instant was considered. */
  evidenceCutoff: string;
  /** §11's cache key: person, tenant, evidence cutoff, retrieval/prompt
   *  version, and the relevant policy versions. Anything missing from this key
   *  is something that can change while a cached brief goes on being served. */
  cacheKey: string;
  provenance: {
    prepVersion: string;
    retrievalPolicyVersion: string;
    clinicalPolicyVersion: string;
    /** Every id the assembler was allowed to cite. */
    authorizedEvidence: number;
    /** Stated rather than implied. */
    excluded: string[];
  };
}

// ---------------------------------------------------------------------------
// Validation — the gate, independent of the assembler
// ---------------------------------------------------------------------------

/**
 * Drop every claim whose citations do not resolve to authorized evidence.
 *
 * Takes the permitted ids rather than deriving them, so a caller cannot widen
 * the evidence set by passing a different loader. Same shape as
 * `validateSummary` in summary.ts, and separate from it because Session Prep
 * cites two kinds of record — ledger events and memory items — and a validator
 * that only knew about one would silently pass the other.
 */
export function validateClaims(
  claims: PrepClaim[], authorized: Set<string>
): { kept: PrepClaim[]; omitted: { text: string; reason: string }[] } {
  const kept: PrepClaim[] = [];
  const omitted: { text: string; reason: string }[] = [];

  for (const claim of claims) {
    if (claim.citations.length === 0) {
      omitted.push({ text: claim.text, reason: "no citation — a claim that cannot cite is not displayed" });
      continue;
    }
    const unresolved = claim.citations.filter((id) => !authorized.has(id));
    if (unresolved.length > 0) {
      omitted.push({
        text: claim.text,
        reason: `cites ${unresolved.length} record(s) outside the authorized evidence for this brief`,
      });
      continue;
    }
    // §11: Steady Noticed items must each carry a Why am I seeing this. A
    // machine-derived line with no explanation is the thing the section is
    // supposed to be the opposite of.
    if (claim.origin === "generated" && !claim.why) {
      omitted.push({ text: claim.text, reason: "machine-derived with no explanation of why it is being shown" });
      continue;
    }
    kept.push(claim);
  }
  return { kept, omitted };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const SESSION_TYPES = new Set(["session.completed", "session.hard_stopped"]);
const BETWEEN_VISIT_TYPES = new Set([
  "daily_checkin.completed", "assessment.scored", "safety_state.changed",
  "intervention.completed", "intervention.response_recorded",
]);

function daysBetween(a: string, b: string): number {
  return Math.floor(Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000);
}

/** The most recent session, or null when there has not been one. */
function lastSessionEntry(timeline: Timeline): TimelineEntry | null {
  const sessions = timeline.entries
    .filter((e) => SESSION_TYPES.has(e.type))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return sessions[0] ?? null;
}

export interface PrepInputs {
  timeline: Timeline;
  /** The clinician's own saved notes, newest first, with the text they wrote or
   *  corrected. The most useful thing in a pre-session brief is what the person
   *  reading it thought last time, in their own words — a machine headline
   *  saying "session completed, SUDS 3 to 1" is true and is not that. */
  notes: Array<{ thoughtId: string; text: string; recordedAt: string; typed: boolean }>;
  /** Active goals with what has happened to them since the last encounter.
   *  Assembled by the goal adapter rather than derived here — a Session Prep
   *  that computed goal movement itself would be a second implementation of
   *  the level fold. */
  goals: GoalContext[];
  /** Displayable response fingerprints, from the projection rather than
   *  recomputed here. A Session Prep that aggregated responses itself would be
   *  a second implementation of §6's thresholds, and the two would eventually
   *  disagree about what counts as enough evidence. */
  responses: ResponseContext[];
  memory: MemoryItem[];
  followUps: FollowUp[];
  threads: Thread[];
  threadEntries: ReturnType<typeof buildTimelines>;
  now: Date;
}

/**
 * Assemble the four deterministic sections plus Steady Noticed.
 *
 * PURE, taking loaded records. Everything here is a function of its inputs, so
 * the brief is reproducible from the same evidence — which is what makes the
 * cache key meaningful and what lets the tests describe the output without a
 * database.
 */
export function assemble(inputs: PrepInputs): PrepClaim[] {
  const { timeline, followUps, threadEntries, goals, notes, responses, now } = inputs;
  const claims: PrepClaim[] = [];
  const nowIso = now.toISOString();

  // --- Last session. -------------------------------------------------------
  const last = lastSessionEntry(timeline);
  if (last) {
    const days = daysBetween(last.occurredAt, nowIso);
    claims.push({
      section: "last_session",
      text:
        days === 0
          ? `Last session was today. ${last.headline}`
          : `Last session was ${days} day${days === 1 ? "" : "s"} ago. ${last.headline}`,
      citations: [last.eventId],
      origin: "deterministic",
    });
  }

  // The clinician's own words about last time, under Last session and directly
  // after the machine line. Quoted rather than summarised: this is the one
  // place in the brief where paraphrasing would lose the thing that makes it
  // worth reading.
  //
  // ONE note, the newest. §11 caps the brief at about a minute and a list of
  // every note ever written is a record, not a brief; the Thoughts page is
  // where the rest of them live.
  const newestNote = notes[0];
  if (newestNote) {
    const trimmed = newestNote.text.length > 400
      ? `${newestNote.text.slice(0, 400).trimEnd()}…`
      : newestNote.text;
    claims.push({
      section: "last_session",
      text: `Your note: “${trimmed}”`,
      // Cited to the thought it came from, so the brief can open it.
      citations: [newestNote.thoughtId],
      origin: "deterministic",
      // A written note and a transcribed one are not the same provenance, and
      // the brief says which — everything else in this feature is careful about
      // that and a summary is not the place to stop being.
      statementClass: "clinician_observation",
    });
  }

  // --- Life goals (expansion handoff 01 §9). -------------------------------
  for (const g of goals) {
    // A goal with nothing behind it cites nothing, and an uncited claim is
    // withheld by the validator below. So it is skipped here rather than
    // produced and dropped — the omission list is for defects, not for
    // routine emptiness.
    if (g.citations.length === 0) continue;
    claims.push({
      section: "life_goals",
      text: goalLine(g),
      citations: g.citations,
      origin: "deterministic",
    });
  }

  // --- What has tended to settle them (expansion handoff 02 §9). -----------
  //
  // The wording is the projection's, not this file's. §6 bars "works",
  // "effective treatment", "caused improvement" and "contraindicated", and the
  // way to keep a summary from drifting into them is for the summary to have no
  // wording of its own — `fingerprintLine` is the single place the sentence is
  // built, and the detail screen renders the same states from the same table.
  for (const r of responses) {
    if (r.citations.length === 0) continue;
    claims.push({
      section: "observed_responses",
      text: r.toWatch ? `Watch: ${r.text}` : r.text,
      citations: r.citations,
      origin: "deterministic",
    });
  }

  // --- You wanted to revisit: the clinician's own follow-ups. --------------
  for (const f of followUps) {
    claims.push({
      section: "revisit",
      text: f.text,
      citations: [f.itemId],
      origin: "deterministic",
      // A follow-up is always the clinician's own observation of what they
      // meant to do; it is not a claim about the patient.
      statementClass: "clinician_observation",
    });
  }

  // --- Between-visit changes, since the last session. ----------------------
  const since = last?.occurredAt ?? null;
  const betweenVisit = timeline.entries
    .filter((e) => BETWEEN_VISIT_TYPES.has(e.type))
    .filter((e) => !since || e.occurredAt > since)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  if (betweenVisit.length > 0) {
    // Grouped by type rather than listed one by one. §11's one-minute cap is
    // the constraint: eleven check-in lines is a log, and a clinician scanning
    // a brief needs the shape, not the transcript of it.
    const byType = new Map<string, TimelineEntry[]>();
    for (const e of betweenVisit) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
    for (const [type, entries] of byType) {
      const label = type.replace(/[._]/g, " ");
      claims.push({
        section: "between_visit",
        text: entries.length === 1
          ? entries[0].headline
          : `${entries.length} ${label} since the last session. Most recent: ${entries[0].headline}`,
        citations: entries.slice(0, 10).map((e) => e.eventId),
        origin: "deterministic",
      });
    }
  }

  // --- Active threads. -----------------------------------------------------
  for (const t of threadEntries) {
    if (t.entries.length === 0) continue;
    const newest = t.entries[t.entries.length - 1];
    const classes = new Set(t.entries.map((e) => e.item.statementClass));
    const allSpeculative = [...classes].every(
      (c) => c === "clinician_hypothesis" || c === "clinician_uncertainty"
    );
    claims.push({
      section: "active_threads",
      text:
        `${t.thread.canonicalLabel} — ${t.entries.length} item${t.entries.length === 1 ? "" : "s"}` +
        (allSpeculative ? ", none recorded as observed" : "") +
        `. Most recent: ${newest.item.displayText}`,
      citations: t.entries.map((e) => e.item.id),
      origin: "deterministic",
      statementClass: newest.item.statementClass,
    });
  }

  // --- Steady noticed. -----------------------------------------------------
  claims.push(...notice(inputs));

  return claims;
}

/**
 * The machine-derived section (§11).
 *
 * Deterministic, despite being the "generated" one. Every noticing here is a
 * cross-reference the assembler can compute and explain — a follow-up that new
 * evidence speaks to, a theme that has gone quiet, a hypothesis nothing has
 * tested. A language model could word these more smoothly; it could not make
 * them more checkable, and §11 asks for generation "mainly for concise wording
 * and synthesis" rather than for the noticing itself.
 *
 * `origin: "generated"` regardless, because the section is machine-created and
 * that is what the label means. Calling it deterministic because no model ran
 * would let the honest label depend on an implementation detail the clinician
 * cannot see.
 */
function notice(inputs: PrepInputs): PrepClaim[] {
  const { memory, followUps, threadEntries, now } = inputs;
  const out: PrepClaim[] = [];
  const nowIso = now.toISOString();

  // A follow-up whose subject has new evidence since it was written.
  for (const f of followUps) {
    if (!f.label) continue;
    const newer = memory.filter(
      (m) =>
        m.id !== f.itemId &&
        m.normalizedLabel === f.label &&
        m.createdAt > f.approvedAt
    );
    if (newer.length === 0) continue;
    out.push({
      section: "steady_noticed",
      text: `There is new material on “${f.label}” since you asked to follow it up.`,
      citations: [f.itemId, ...newer.map((m) => m.id)],
      origin: "generated",
      why: `You kept a follow-up about “${f.label}”, and ${newer.length} later item${newer.length === 1 ? " carries" : "s carry"} the same label.`,
    });
  }

  // A theme with nothing new for a long time. Dormant-then-back is a shape
  // worth seeing, and so is dormant-and-still-dormant before a session.
  for (const t of threadEntries) {
    if (t.entries.length < 2) continue;
    const newest = t.entries[t.entries.length - 1];
    const quietDays = daysBetween(newest.item.createdAt, nowIso);
    if (quietDays < 60) continue;
    out.push({
      section: "steady_noticed",
      text: `Nothing has been added to “${t.thread.canonicalLabel}” in ${quietDays} days.`,
      citations: t.entries.map((e) => e.item.id),
      origin: "generated",
      why: `The most recent item under this theme is ${quietDays} days old, and the theme is still marked active.`,
    });
  }

  // A hypothesis nothing has since spoken to. Named because an untested
  // hypothesis quietly hardening into a working assumption is the failure the
  // statement classes exist to prevent, and time is how it happens.
  for (const h of memory) {
    if (h.statementClass !== "clinician_hypothesis") continue;
    const age = daysBetween(h.createdAt, nowIso);
    if (age < 60) continue;
    const relevant = h.normalizedLabel
      ? memory.filter((m) => m.id !== h.id && m.normalizedLabel === h.normalizedLabel && m.createdAt > h.createdAt)
      : [];
    if (relevant.length > 0) continue;
    out.push({
      section: "steady_noticed",
      text: `A hypothesis from ${age} days ago has had nothing added to it since.`,
      citations: [h.id],
      origin: "generated",
      statementClass: h.statementClass,
      why: "It is recorded as a hypothesis, it is more than sixty days old, and no later item shares its subject.",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The whole pipeline
// ---------------------------------------------------------------------------

export interface BuildPrepOptions {
  now?: Date;
  policy?: ClinicalPolicy;
  /** Nothing recorded after this is considered. Defaults to now. */
  asOf?: string;
}

export async function buildSessionPrep(
  ctx: TenantContext, personId: string, opts: BuildPrepOptions = {}
): Promise<SessionPrep> {
  const now = opts.now ?? new Date();
  const policy = opts.policy ?? activePolicy();
  const evidenceCutoff = opts.asOf ?? now.toISOString();

  const [timeline, memory, followUps, threads, memberships] = await Promise.all([
    memberTimeline(personId, { asOf: evidenceCutoff, policy }),
    approvedMemory(ctx, personId),
    openFollowUps(ctx, { personId, now }),
    listThreads(ctx, personId, "active"),
    membershipsForPerson(ctx, personId),
  ]);
  // After the timeline, because the last session is what "since the last
  // encounter" means and the timeline is where it is found.
  const lastSessionAt = timeline.entries
    .filter((e) => SESSION_TYPES.has(e.type))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt ?? null;
  const goals = await goalContextFor(ctx, personId, { since: lastSessionAt, now });
  // Computed over the same cutoff as everything else in the brief, so a brief
  // and the screen it links to describe the same evidence.
  const responses = await responseContextFor(ctx, personId, { asOf: evidenceCutoff });

  // The clinician's own saved notes. Only SAVED ones: a thought still in review
  // is a draft of a judgement, and putting one in a brief would show a
  // clinician their own unfinished thinking as though they had settled it.
  const savedThoughts = (await listThoughts(ctx, personId, 10))
    .filter((t) => t.status === "saved");
  const notes: PrepInputs["notes"] = [];
  for (const t of savedThoughts) {
    const transcript = await currentTranscript(ctx, t);
    if (!transcript) continue;
    notes.push({
      thoughtId: t.id,
      text: transcript.text,
      recordedAt: t.recordedAt,
      typed: transcript.createdBy === "clinician" && transcript.version === 1,
    });
  }
  notes.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const threadItems = await itemsByIds(ctx, memberships.map((m) => m.memoryItemId));
  const threadEntries = buildTimelines(threads, memberships, threadItems);

  // The authorized set is built ONCE, from what was actually loaded, and the
  // validator is given it rather than a way to look things up. A claim can only
  // cite what this brief was allowed to read.
  const authorized = new Set<string>([
    ...timeline.entries.map((e) => e.eventId),
    ...memory.map((m) => m.id),
    ...threadItems.map((i) => i.id),
    ...followUps.map((f) => f.itemId),
    // Goal observations are evidence like any other, and a goal line that
    // cited one outside this set would be withheld exactly like any other
    // uncited claim.
    ...goals.flatMap((g) => g.citations),
    // Intervention instances are evidence like any other. A response line that
    // cited one outside this set is withheld exactly like any other uncited
    // claim — which is the behaviour that makes "every pattern opens evidence"
    // true in the brief as well as on the screen.
    ...responses.flatMap((r) => r.citations),
    // A note cites its own thought, which the clinician is by definition
    // authorized to read — it is theirs.
    ...notes.map((n) => n.thoughtId),
  ]);

  const produced = assemble({
    timeline, memory, followUps, threads, threadEntries, goals, notes, responses, now,
  });
  const { kept, omitted } = validateClaims(produced, authorized);

  const sections: Record<PrepSection, PrepClaim[]> = {
    last_session: [], life_goals: [], observed_responses: [], revisit: [],
    between_visit: [], active_threads: [], steady_noticed: [],
  };
  for (const c of kept) sections[c.section].push(c);

  return {
    personId,
    sections,
    omitted,
    evidenceCutoff,
    cacheKey: prepCacheKey({
      personId, tenantId: ctx.tenantId, evidenceCutoff,
      clinicalPolicyVersion: CLINICAL_POLICY_VERSION,
    }),
    provenance: {
      prepVersion: SESSION_PREP_VERSION,
      retrievalPolicyVersion: RETRIEVAL_POLICY_VERSION,
      clinicalPolicyVersion: CLINICAL_POLICY_VERSION,
      authorizedEvidence: authorized.size,
      excluded: [
        ...(timeline.withheld.count > 0
          ? [`${timeline.withheld.count} timeline event(s) withheld: ${timeline.withheld.reason}`]
          : []),
        "Candidate items nobody kept",
        "Connections not yet accepted",
      ],
    },
  };
}

/**
 * §11's cache key.
 *
 * Every input that can change the brief is IN the key. That is the whole
 * requirement — a key missing the policy version serves a brief composed under
 * rules that no longer apply, and nothing about the stale answer looks stale.
 */
export function prepCacheKey(args: {
  personId: string;
  tenantId: string;
  evidenceCutoff: string;
  clinicalPolicyVersion: string;
}): string {
  const material = [
    args.tenantId,
    args.personId,
    args.evidenceCutoff,
    SESSION_PREP_VERSION,
    RETRIEVAL_POLICY_VERSION,
    args.clinicalPolicyVersion,
    // The response policy is in the key for the same reason the clinical one
    // is: change §6's thresholds and the brief's response lines change with
    // them, and a cached brief composed under the old thresholds looks exactly
    // like one composed under the new.
    RESPONSE_POLICY.version,
  ].join("|");
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 24);
}
