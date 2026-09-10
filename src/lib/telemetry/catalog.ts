// Telemetry, as a catalog with a privacy rule per signal (handoff 06 §31.7).
//
// WHY A CATALOG AND NOT A LOGGER. §31.3's definition of done says "telemetry
// proves the screen can be used without capturing sensitive free text". That is
// a claim about what the product CANNOT record, and a logger cannot make it —
// a logger records whatever it is handed. So the nine signals §31.7 names are
// declared here with the fields each one may carry, and every field carries a
// KIND whose shape a sentence cannot satisfy. A caller that tries to attach a
// member's own words is refused by `sanitize`, not reviewed later.
//
// THE HARD RULE, from §31.7's last two rows and §31.8's list. `permission_denied`
// carries the actor's role and a policy code AND NO SUBJECT IDENTITY: a denial
// log that names who was being looked at leaks exactly the existence §30.6 step
// 2 refuses to reveal. So no signal in this catalog may declare a field that
// names a person, and none may declare a field that holds prose.
//
// WHAT THIS IS NOT. It is not analytics on people. Every field is a code, a
// role, an id of something that is not a person, or a number. Nothing here can
// answer "what did this member say" or "who was denied", and the operational
// review below is written to be answerable from that alone.

/** What a field may hold. The kinds exist so the constraint is checkable: a
 *  sentence does not match `code`, and a person's name does not match any of
 *  them. */
export type FieldKind = "code" | "role" | "ref" | "count" | "duration_ms" | "age_s";

export interface TelemetryField {
  name: string;
  kind: FieldKind;
}

export interface TelemetrySignal {
  /** §31.7's signal name, unchanged. */
  name: string;
  /** §31.7's Purpose column. What question this signal is here to answer. */
  purpose: string;
  /** §31.7's Privacy rule column. The limit, stated where the fields are. */
  privacyRule: string;
  fields: TelemetryField[];
  /** Where this catalog does NOT carry something §31.7 names, and where a
   *  reviewer finds it instead. Present on the screen, so a reader sees the
   *  gap rather than assuming coverage. */
  deviation?: string;
  /**
   * The modules that record this signal, relative to src/.
   *
   * Declared rather than discovered so that a count of zero can be READ. A
   * signal at zero because nobody has used the screen and a signal at zero
   * because nothing records it are the same number and completely different
   * findings, and the operational review is worthless if it cannot tell them
   * apart. An empty list is the honest state for a signal whose surface does
   * not exist yet, and the screen says so in those words.
   *
   * Held to the source by tests/telemetry.test.ts: every path listed here
   * really calls this signal, and every call site in the codebase is listed.
   */
  recordedFrom: string[];
}

/** A code, role or reference: a fixed vocabulary token. No spaces and no
 *  sentence punctuation, which is what makes "no free text" enforceable rather
 *  than aspirational. */
const CODE = /^[a-z0-9_]{1,48}$/;
const REF = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Field names this catalog may never contain, whatever their kind. A person's
 *  identity and a person's words are the two things §31.7 keeps out of every
 *  row, so they are refused at the point the catalog is written rather than at
 *  the point somebody fills one in. */
export const FORBIDDEN_FIELD_NAME =
  /person|patient|member|subject|client|user|name|email|phone|text|body|message|note|content|answer|free|comment|detail/i;

export const SIGNALS: TelemetrySignal[] = [
  {
    name: "decision_surface_viewed",
    purpose: "Measure screen reach and load state",
    privacyRule: "No patient free text",
    fields: [
      { name: "surface", kind: "code" },
      { name: "loadState", kind: "code" },
    ],
    recordedFrom: [
      "app/clinician/today/page.tsx",
      "app/app/today/page.tsx",
    ],
  },
  {
    name: "primary_action_selected",
    purpose: "Measure whether hierarchy works",
    privacyRule: "Action code only",
    fields: [{ name: "actionCode", kind: "code" }],
    recordedFrom: [
      "lib/clinical/shell-actions.ts",
    ],
  },
  {
    name: "evidence_opened",
    purpose: "Measure trust and review depth",
    privacyRule: "Evidence type, not content",
    fields: [{ name: "evidenceType", kind: "code" }],
    recordedFrom: [
      "app/api/planning/signals/[id]/lineage/route.ts",
    ],
  },
  {
    name: "queue_item_resolved",
    purpose: "Measure time to accountable action",
    privacyRule: "Reason code, owner role and duration",
    fields: [
      { name: "reasonCode", kind: "code" },
      { name: "ownerRole", kind: "role" },
      { name: "durationMs", kind: "duration_ms" },
    ],
    recordedFrom: [
      "lib/clinical/shell-actions.ts",
    ],
  },
  {
    name: "gate_support_selected",
    purpose: "Verify support paths are used",
    privacyRule: "Support option code only",
    fields: [{ name: "supportOption", kind: "code" }],
    recordedFrom: [
      "lib/sos.ts",
    ],
  },
  {
    name: "chart_range_changed",
    purpose: "Measure analytic use",
    privacyRule: "Range and metric IDs",
    fields: [
      { name: "rangeId", kind: "ref" },
      { name: "metricId", kind: "ref" },
    ],
    recordedFrom: [],
  },
  {
    name: "export_requested",
    purpose: "Track purpose and filter parity",
    privacyRule: "Purpose, cohort version and filter hash",
    fields: [
      { name: "surface", kind: "code" },
      { name: "cohortVersion", kind: "ref" },
      { name: "filterHash", kind: "ref" },
    ],
    deviation:
      "§31.7 names the purpose. This product requires an export's purpose to be a " +
      "written sentence of at least twelve characters, which is prose — and prose is " +
      "the one thing no signal here may carry. It is recorded in full on the export's " +
      "own audit event and on the export register, which is where a reviewer reads it. " +
      "What travels here is the screen that asked, so an unexpected export surface is " +
      "still visible in the counts.",
    recordedFrom: [
      "lib/intelligence/export.ts",
    ],
  },
  {
    name: "projection_stale_shown",
    purpose: "Detect feed and projection delay",
    privacyRule: "Projection type, age and source status",
    fields: [
      { name: "projectionType", kind: "code" },
      { name: "ageSeconds", kind: "age_s" },
      { name: "sourceStatus", kind: "code" },
    ],
    recordedFrom: [
      "app/clinician/today/page.tsx",
      "app/app/today/page.tsx",
    ],
  },
  {
    name: "permission_denied",
    purpose: "Detect access friction and attacks",
    privacyRule: "Actor role and policy code; no subject identity",
    fields: [
      { name: "actorRole", kind: "role" },
      { name: "policyCode", kind: "code" },
    ],
    recordedFrom: [
      "lib/auth.ts",
    ],
  },
];

export const SIGNAL_NAMES = SIGNALS.map((s) => s.name);

export function signal(name: string): TelemetrySignal | null {
  return SIGNALS.find((s) => s.name === name) ?? null;
}

export class TelemetryRefused extends Error {}

/** Whether a value is allowed in a field of this kind. The numeric kinds are
 *  finite and non-negative because an unbounded number is how a timestamp — and
 *  therefore a person's schedule — gets into a row that is not supposed to
 *  carry one. */
export function valueAllowed(kind: FieldKind, value: unknown): boolean {
  switch (kind) {
    case "code":
    case "role":
      return typeof value === "string" && CODE.test(value);
    case "ref":
      return typeof value === "string" && REF.test(value);
    case "count":
      return typeof value === "number" && Number.isInteger(value) && value >= 0;
    case "duration_ms":
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    case "age_s":
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }
}

/**
 * The recorded row for a signal, or a refusal.
 *
 * TWO DIFFERENT FAILURES, DELIBERATELY TREATED DIFFERENTLY. A field the catalog
 * does not declare is DROPPED: a caller passing something extra is a caller
 * who has not read this file, and dropping it keeps the row correct. A declared
 * field whose value does not fit its kind THROWS: that is a caller putting
 * prose into `reasonCode`, and quietly recording a truncated version of a
 * member's sentence is the exact harm §31.7 is written to prevent.
 */
export function sanitize(
  signalName: string,
  payload: Record<string, unknown>
): { fields: Record<string, string | number>; dropped: string[] } {
  const spec = signal(signalName);
  if (!spec) throw new TelemetryRefused(`${signalName} is not a declared signal`);

  const fields: Record<string, string | number> = {};
  const declared = new Set(spec.fields.map((f) => f.name));
  const dropped = Object.keys(payload).filter((k) => !declared.has(k)).sort();

  for (const f of spec.fields) {
    if (!(f.name in payload)) continue;
    const v = payload[f.name];
    if (!valueAllowed(f.kind, v)) {
      throw new TelemetryRefused(
        `${signalName}.${f.name} must be a ${f.kind}; a value of that shape can carry text this signal may not record`
      );
    }
    fields[f.name] = v as string | number;
  }
  return { fields, dropped };
}

/**
 * §31.7's closing paragraph, as four questions with the signals that answer
 * them.
 *
 * Written as a structure rather than a sentence because the useful property is
 * COVERAGE: a question whose signals are all absent from the record is a
 * question this product cannot currently answer, and the review screen says so
 * instead of leaving a reader to assume otherwise.
 */
export interface ReviewQuestion {
  question: string;
  answeredBy: string[];
}

export const OPERATIONAL_REVIEW: ReviewQuestion[] = [
  {
    question: "Did users reach the right action?",
    answeredBy: ["decision_surface_viewed", "primary_action_selected", "queue_item_resolved"],
  },
  {
    question: "Was evidence available when it was wanted?",
    answeredBy: ["evidence_opened", "gate_support_selected"],
  },
  {
    question: "Was the data current?",
    answeredBy: ["projection_stale_shown", "chart_range_changed"],
  },
  {
    question: "Did any role see more information than it needed?",
    answeredBy: ["permission_denied", "export_requested"],
  },
];

/** Which of a question's signals have never been recorded. */
export function unanswerable(q: ReviewQuestion, recorded: ReadonlySet<string>): string[] {
  return q.answeredBy.filter((s) => !recorded.has(s));
}
