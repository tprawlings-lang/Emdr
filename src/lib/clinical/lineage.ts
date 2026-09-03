// Lineage — trace a screen statement to its source event
// (§26 p44 "/review/lineage", contract lineage_trace.v4, worked example p71;
// pipeline §30.1 p85).
//
// §30.1 draws five stages: source events → event ledger → policy and scoring →
// projections → role views. A reviewer looking at a sentence on a screen is
// standing at the right-hand end of that diagram, and the question this module
// answers is whether they can walk left along it until they reach something
// that actually happened.
//
// EVERY HOP IS A QUERY, NOT A NARRATION. That is the whole design. A lineage
// screen that draws the pipeline as five boxes with ticks has told the reviewer
// what the architecture diagram already said. What they need to know is whether
// THIS statement, the one in front of them, rests on a recorded event — and the
// only way to answer that is to look.
//
// The join that makes it possible: every event that produces a current-state
// row carries that row's primary key in `payload.projectionId` (see
// projections.ts, whose PROJECTORS are the definition of "projected"). So a
// statement's provenance is the set of events whose projectionId is the row it
// was read from, and a statement with none of those is a row nobody appended.
//
// p71 names three states, and the third is the one that costs something to
// implement honestly:
//
//   complete   — every stage resolved, and the events are original.
//   gap        — a stage has no source. Stated with the reason, never hidden.
//   superseded — a correction was appended over one of the source events.
//                Corrections append and supersede; they never erase history,
//                so the superseded event stays in the trace and is marked.
//
// The reconstructed case is deliberately a GAP rather than a pass. Genesis
// backfill wrote events FROM existing rows, so a row "supported" by one is
// supported by a copy of itself. Reporting that as complete would make this
// screen the most confident liar in the product.

import { data } from "../data";
import { PROJECTED_TABLES, type ProjectedTable } from "../projections";
import { isReconstructed } from "../spine-backfill";
import { CHECKIN_ROUTING_VERSION } from "../gating";

export type LineageState = "complete" | "gap" | "superseded";

/** §30.1's stages, right to left — the order a reviewer walks them. */
export const PIPELINE_STAGES = [
  "Role views",
  "Projections",
  "Policy and scoring",
  "Event ledger",
  "Source events",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface LineageStep {
  stage: PipelineStage;
  /** What §30.1 says this stage is for, in the reviewer's words. */
  role: string;
  resolved: boolean;
  /** This stage does not apply to this kind of statement. Distinct from a gap:
   *  a practice completion records something a person did, and no gate decided
   *  it. Calling that a missing hop would teach a reviewer to ignore the word
   *  "gap", which is the only word on this screen that has to keep its force. */
  notApplicable?: boolean;
  /** What was found. A row id, an event count, a version — never a verdict. */
  found: string;
  /** Why it did not resolve. Empty when it did. */
  gap: string;
  /** The version this stage stamped, when it stamps one. */
  version: string | null;
}

export interface LineageEvent {
  id: string;
  type: string;
  occurredAt: string;
  recordedAt: string;
  actorType: string;
  sourceSystem: string;
  /** Written by genesis backfill from the row it claims to support. */
  reconstructed: boolean;
  /** The event this one corrects, if it is a correction. */
  supersedes: string | null;
  /** The correction appended over this event, if there is one. */
  supersededBy: string | null;
}

export interface LineageTrace {
  /** `table:rowId` — the address of the statement, stable across reloads. */
  id: string;
  table: ProjectedTable;
  rowId: string;
  personId: string;
  /** The sentence a reader sees, on the screen that shows it. */
  statement: string;
  screen: { label: string; href: string };
  state: LineageState;
  steps: LineageStep[];
  events: LineageEvent[];
}

/** One traceable kind of statement: which projected table it is read from, the
 *  sentence a screen renders from that row, and where it is rendered.
 *
 *  Keyed by ProjectedTable rather than by a list of its own, so a table that
 *  gains a projector without gaining an entry here fails a guard instead of
 *  quietly becoming untraceable. */
interface StatementKind {
  /** Columns the sentence needs, beyond id and user_id. Qualified with the
   *  statement table's alias at query time — `persons` carries a `created_at`
   *  of its own, and an unqualified one is ambiguous rather than wrong, which
   *  SQLite reports and Postgres would too. */
  columns: string[];
  sentence: (r: Record<string, unknown>) => string;
  screen: (personId: string) => { label: string; href: string };
  /** The rule or policy that decided this row's content, when one did. */
  policy: { name: string; version: string } | null;
  /** Newest first, by this column. */
  orderBy: string;
}

const KINDS: Record<ProjectedTable, StatementKind> = {
  checkins: {
    columns: ["checkin_date", "recommended_action", "created_at"],
    sentence: (r) =>
      `The check-in on ${r.checkin_date} routed this person to ${String(r.recommended_action).replace(/_/g, " ")}.`,
    screen: (p) => ({ label: "Clinician — person record", href: `/clinician/person/${p}` }),
    policy: { name: "Daily check-in routing", version: CHECKIN_ROUTING_VERSION },
    orderBy: "created_at",
  },
  therapy_sessions: {
    columns: ["module_id", "status", "pre_suds", "post_suds", "started_at"],
    sentence: (r) =>
      `The ${r.module_id} session ended ${r.status}` +
      (r.pre_suds !== null && r.post_suds !== null
        ? `, with distress ${r.pre_suds} before and ${r.post_suds} after.`
        : "."),
    screen: (p) => ({ label: "Clinician — person record", href: `/clinician/person/${p}` }),
    policy: { name: "Session runtime safety", version: "session-engine-v1" },
    orderBy: "started_at",
  },
  practice_completions: {
    columns: ["practice_id", "practice_type", "duration_sec", "created_at"],
    sentence: (r) =>
      `A ${r.practice_type} practice (${r.practice_id}) was completed, lasting ${r.duration_sec} seconds.`,
    screen: (p) => ({ label: "Clinician — person record", href: `/clinician/person/${p}` }),
    policy: null,
    orderBy: "created_at",
  },
  lesson_reads: {
    columns: ["lesson_id", "created_at"],
    sentence: (r) => `The lesson ${r.lesson_id} was read.`,
    screen: (p) => ({ label: "Clinician — person record", href: `/clinician/person/${p}` }),
    policy: null,
    orderBy: "created_at",
  },
  consents: {
    columns: ["scope", "policy_version", "granted_at", "revoked_at"],
    sentence: (r) =>
      r.revoked_at
        ? `Consent for ${r.scope} was withdrawn on ${String(r.revoked_at).slice(0, 10)}.`
        : `Consent for ${r.scope} is in force under policy ${r.policy_version}.`,
    screen: () => ({ label: "Audit trail", href: "/review/audit" }),
    policy: null,
    orderBy: "granted_at",
  },
  module_unlocks: {
    columns: ["module_id", "status", "override", "requested_at"],
    sentence: (r) =>
      `Access to ${r.module_id} is ${r.status}` + (r.override ? ", by clinician override." : "."),
    screen: (p) => ({ label: "Clinician — person record", href: `/clinician/person/${p}` }),
    policy: { name: "Module access gate", version: "module-access-gate-v1" },
    orderBy: "requested_at",
  },
};

/** What each stage is for, quoted from §30.1's own boxes. */
const STAGE_ROLE: Record<PipelineStage, string> = {
  "Role views": "Authorized actions, evidence references, freshness and audit response",
  Projections: "Member, clinician, organization, payer and audit presentation objects",
  "Policy and scoring": "Validated instruments, deterministic gates, state transitions",
  "Event ledger": "Append-only event, tenant, actor, purpose, source, schema and version",
  "Source events": "Check-in, measure, session, consent, message, referral, claim",
};

export interface StatementRef {
  id: string;
  table: ProjectedTable;
  personId: string;
  personLabel: string;
  statement: string;
  at: string;
}

/** Candidate statements to trace, newest first. Read from the live tables, so
 *  the list is what the product currently says rather than a fixture. */
export async function traceableStatements(
  opts: { table?: ProjectedTable; personId?: string; limit?: number } = {}
): Promise<StatementRef[]> {
  const c = await data();
  const tables = opts.table ? [opts.table] : [...PROJECTED_TABLES];
  const perTable = Math.max(1, Math.floor((opts.limit ?? 30) / tables.length));
  const out: StatementRef[] = [];

  for (const t of tables) {
    const k = KINDS[t];
    const where = opts.personId ? " WHERE t.user_id = ?" : "";
    const cols = k.columns.map((col) => `t.${col}`).join(", ");
    const rows = (await c.all(
      `SELECT t.id, t.user_id, ${cols}, p.display_name
         FROM ${t} t LEFT JOIN persons p ON p.id = t.user_id${where}
        ORDER BY t.${k.orderBy} DESC LIMIT ?`,
      opts.personId ? [opts.personId, perTable] : [perTable]
    )) as Array<Record<string, unknown>>;

    for (const r of rows) {
      out.push({
        id: `${t}:${String(r.id)}`,
        table: t,
        personId: String(r.user_id),
        // Aggregate populations carry a NULL display name on purpose; a
        // lineage list is not the place that gets to reverse that.
        personLabel: r.display_name ? String(r.display_name) : "Name withheld at this scope",
        statement: k.sentence(r),
        at: String(r[k.orderBy] ?? ""),
      });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function parseStatementId(id: string): { table: ProjectedTable; rowId: string } | null {
  const i = id.indexOf(":");
  if (i < 0) return null;
  const table = id.slice(0, i);
  const rowId = id.slice(i + 1);
  if (!rowId) return null;
  if (!(PROJECTED_TABLES as readonly string[]).includes(table)) return null;
  return { table: table as ProjectedTable, rowId };
}

/** Walk one statement back through §30.1's pipeline. */
export async function traceStatement(statementId: string): Promise<LineageTrace | null> {
  const parsed = parseStatementId(statementId);
  if (!parsed) return null;
  const { table, rowId } = parsed;
  const k = KINDS[table];
  const c = await data();

  const row = (await c.get(
    `SELECT id, user_id, ${k.columns.join(", ")} FROM ${table} WHERE id = ?`, [rowId]
  )) as Record<string, unknown> | undefined;
  if (!row) return null;

  const personId = String(row.user_id);

  // The ledger side of the join. `json_extract` is how the projector finds its
  // target row, so it is how the trace finds the events that produced it.
  const raw = (await c.all(
    `SELECT id, event_type, occurred_at, recorded_at, actor_type, source_system,
            payload_version, supersedes_event_id
       FROM longitudinal_events
      WHERE json_extract(payload, '$.projectionId') = ?
      ORDER BY id`, [rowId]
  )) as Array<Record<string, unknown>>;

  const ids = raw.map((e) => String(e.id));
  const corrections = ids.length
    ? ((await c.all(
        `SELECT id, supersedes_event_id FROM longitudinal_events
          WHERE supersedes_event_id IN (${ids.map(() => "?").join(",")})`, ids
      )) as Array<Record<string, unknown>>)
    : [];
  const correctionOf = new Map(corrections.map((r) => [String(r.supersedes_event_id), String(r.id)]));

  const events: LineageEvent[] = raw.map((e) => ({
    id: String(e.id),
    type: String(e.event_type),
    occurredAt: String(e.occurred_at),
    recordedAt: String(e.recorded_at),
    actorType: String(e.actor_type),
    sourceSystem: String(e.source_system),
    reconstructed: isReconstructed({
      payload_version: Number(e.payload_version),
      source_system: String(e.source_system),
    }),
    supersedes: e.supersedes_event_id ? String(e.supersedes_event_id) : null,
    supersededBy: correctionOf.get(String(e.id)) ?? null,
  }));

  const original = events.filter((e) => !e.reconstructed);
  const superseded = events.some((e) => e.supersededBy !== null);

  const steps: LineageStep[] = [
    {
      stage: "Role views",
      role: STAGE_ROLE["Role views"],
      resolved: true,
      found: `${k.screen(personId).label} — ${k.screen(personId).href}`,
      gap: "",
      version: null,
    },
    {
      stage: "Projections",
      role: STAGE_ROLE.Projections,
      resolved: true,
      found: `${table} row ${rowId}`,
      gap: "",
      version: null,
    },
    k.policy
      ? {
          stage: "Policy and scoring" as const,
          role: STAGE_ROLE["Policy and scoring"],
          resolved: true,
          found: k.policy.name,
          gap: "",
          version: k.policy.version,
        }
      : {
          stage: "Policy and scoring" as const,
          role: STAGE_ROLE["Policy and scoring"],
          resolved: false,
          notApplicable: true,
          found: "",
          gap: "No gate or score decided this row. It records something a person did, not a decision about them.",
          version: null,
        },
    events.length > 0
      ? {
          stage: "Event ledger" as const,
          role: STAGE_ROLE["Event ledger"],
          resolved: true,
          found: `${events.length} event${events.length === 1 ? " names" : "s name"} this row`,
          gap: "",
          version: null,
        }
      : {
          stage: "Event ledger" as const,
          role: STAGE_ROLE["Event ledger"],
          resolved: false,
          found: "",
          gap: "No event carries this row's id. The row was written directly, so the ledger cannot rebuild it.",
          version: null,
        },
    original.length > 0
      ? {
          stage: "Source events" as const,
          role: STAGE_ROLE["Source events"],
          resolved: true,
          found: `${original.length} original event${original.length === 1 ? "" : "s"} from ${
            [...new Set(original.map((e) => e.sourceSystem))].join(", ")
          }`,
          gap: "",
          version: null,
        }
      : {
          stage: "Source events" as const,
          role: STAGE_ROLE["Source events"],
          resolved: false,
          found: "",
          gap:
            events.length > 0
              ? "Every event here was reconstructed from this row by genesis backfill. The row is not derived from them; they are derived from it."
              : "Nothing upstream of the row exists to read.",
          version: null,
        },
  ];

  // Order matters: a superseded chain is still a traced one, so supersession is
  // only the verdict when nothing is missing. A trace that is both incomplete
  // and corrected is reported as the gap, because that is the part a reviewer
  // has to act on.
  const state: LineageState = steps.some((s) => !s.resolved && !s.notApplicable)
    ? "gap"
    : superseded
      ? "superseded"
      : "complete";

  return {
    id: `${table}:${rowId}`,
    table,
    rowId,
    personId,
    statement: k.sentence(row),
    screen: k.screen(personId),
    state,
    steps,
    events,
  };
}
