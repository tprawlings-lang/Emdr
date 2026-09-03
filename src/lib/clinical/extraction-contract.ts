import crypto from "node:crypto";

// The extraction contract (§9.1) and the validator that enforces §9.2.
//
// The model returns JSON. This module is the only thing standing between that
// JSON and the clinical record, so it treats the payload as hostile — not
// because a provider is an adversary, but because the failure mode here is a
// model that is confidently, plausibly wrong, and every one of §9.2's rules
// describes a way that looks exactly like a correct answer.
//
// THE RULES THAT BECOME MECHANISMS RATHER THAN INSTRUCTIONS:
//
//   Offsets are CHECKED AGAINST THE TRANSCRIPT. §9.2 says "return source
//   offsets when reliable… return null rather than inventing them", which is a
//   request the model cannot be relied on to honour, since inventing plausible
//   offsets is the cheap answer. The item carries a hash of the quoted span, so
//   the span is re-read from the transcript and re-hashed here. A quote that
//   does not match its offsets loses its offsets — the item survives, the false
//   citation does not.
//
//   SPECULATION CANNOT BE FILED AS OBSERVATION. §9.2: "do not turn clinician
//   speculation into patient fact." An item typed `clinician_hypothesis` or
//   `clinician_uncertainty` whose statementClass says `clinician_observation`
//   or `patient_report` is the exact shape of that mistake, and it is rejected
//   rather than corrected — a validator that silently repaired it would hide
//   how often the model tries.
//
//   THREAD RELATIONSHIPS ARE REFUSED. §9.2: "do not create thread
//   relationships in the extraction task." Any item carrying thread fields is
//   rejected, so the Phase 3 rule "no auto-link in v1" cannot be undone by an
//   extraction payload that arrives with links already in it.
//
//   APPROXIMATION IS PART OF THE NUMBER. §9.2: "keep numeric values exactly as
//   stated and mark approximations when the transcript says 'about' or
//   similar." An approximate 3 and an exact 3 are different clinical facts, so
//   `approximate` is a field on the numeric rather than a word in the text.

export const EXTRACTION_SCHEMA_VERSION = "1";

export type ItemType =
  | "observation" | "symptom" | "person_relationship" | "event"
  | "intervention" | "intervention_response" | "treatment_target"
  | "follow_up" | "goal" | "theme"
  | "clinician_hypothesis" | "clinician_uncertainty";

export type StatementClass =
  | "clinician_observation" | "patient_report"
  | "clinician_hypothesis" | "clinician_uncertainty";

export const ITEM_TYPES: ItemType[] = [
  "observation", "symptom", "person_relationship", "event",
  "intervention", "intervention_response", "treatment_target",
  "follow_up", "goal", "theme",
  "clinician_hypothesis", "clinician_uncertainty",
];

export const STATEMENT_CLASSES: StatementClass[] = [
  "clinician_observation", "patient_report",
  "clinician_hypothesis", "clinician_uncertainty",
];

export interface NumericFact {
  name: string;
  value: number;
  unit?: string;
  /** True when the transcript hedged the number ("about eight"). §9.2 asks for
   *  approximations to be marked; an approximate value stored as an exact one
   *  is a fact the clinician never stated. */
  approximate?: boolean;
}

export interface ExtractionItem {
  tempId: string;
  itemType: ItemType;
  statementClass: StatementClass;
  displayText: string;
  normalizedLabel: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  sourceQuoteHash: string | null;
  numericFacts?: NumericFact[];
}

export interface ThoughtExtractionV1 {
  schemaVersion: "1";
  transcriptId: string;
  items: ExtractionItem[];
}

/** Hash of a quoted span. The same function produces it and checks it, so a
 *  citation cannot pass validation by being hashed differently from how it is
 *  verified. */
export function quoteHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** An item type that is inherently the clinician thinking aloud. §4's example:
 *  "I think this may connect to abandonment" is not "abandonment is an active
 *  patient theme". */
const SPECULATIVE_TYPES = new Set<ItemType>(["clinician_hypothesis", "clinician_uncertainty"]);
/** Classes that assert something happened or was said, rather than something
 *  being wondered. */
const ASSERTIVE_CLASSES = new Set<StatementClass>(["clinician_observation", "patient_report"]);

export interface ValidationIssue {
  tempId: string | null;
  problem: string;
}

export interface ValidatedExtraction {
  items: ExtractionItem[];
  /** Items the payload contained and this module refused, with the reason.
   *  Surfaced rather than swallowed: a model that keeps proposing rejected
   *  shapes is a fact about the task, and a silent filter hides it. */
  rejected: ValidationIssue[];
  /** Citations that did not match the transcript and were dropped. The item
   *  survives without its offsets. */
  droppedCitations: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a raw extraction payload against the transcript it claims to
 * describe.
 *
 * `transcriptText` is required, not optional: without it the offsets cannot be
 * checked, and an offset nobody checked is the thing §9.2 is trying to prevent.
 */
export function validateExtraction(
  raw: unknown,
  transcriptId: string,
  transcriptText: string
): ValidatedExtraction {
  const rejected: ValidationIssue[] = [];
  const items: ExtractionItem[] = [];
  let droppedCitations = 0;

  if (!isObject(raw)) {
    return { items: [], rejected: [{ tempId: null, problem: "payload is not an object" }], droppedCitations: 0 };
  }
  if (raw.schemaVersion !== EXTRACTION_SCHEMA_VERSION) {
    return {
      items: [],
      rejected: [{ tempId: null, problem: `unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}` }],
      droppedCitations: 0,
    };
  }
  // A payload describing a different transcript is not a validation warning, it
  // is the wrong evidence attached to a person's record.
  if (raw.transcriptId !== transcriptId) {
    return {
      items: [],
      rejected: [{ tempId: null, problem: "payload transcriptId does not match the transcript it was run against" }],
      droppedCitations: 0,
    };
  }
  if (!Array.isArray(raw.items)) {
    return { items: [], rejected: [{ tempId: null, problem: "items is not an array" }], droppedCitations: 0 };
  }

  const seen = new Set<string>();

  for (const entry of raw.items) {
    if (!isObject(entry)) {
      rejected.push({ tempId: null, problem: "item is not an object" });
      continue;
    }
    const tempId = typeof entry.tempId === "string" ? entry.tempId : null;
    const fail = (problem: string) => rejected.push({ tempId, problem });

    if (!tempId) { fail("missing tempId"); continue; }
    if (seen.has(tempId)) { fail("duplicate tempId"); continue; }

    const itemType = entry.itemType;
    const statementClass = entry.statementClass;
    if (typeof itemType !== "string" || !(ITEM_TYPES as string[]).includes(itemType)) {
      fail(`unknown itemType ${JSON.stringify(itemType)}`); continue;
    }
    if (typeof statementClass !== "string" || !(STATEMENT_CLASSES as string[]).includes(statementClass)) {
      fail(`unknown statementClass ${JSON.stringify(statementClass)}`); continue;
    }

    // §9.2: do not turn clinician speculation into patient fact.
    if (SPECULATIVE_TYPES.has(itemType as ItemType) && ASSERTIVE_CLASSES.has(statementClass as StatementClass)) {
      fail(`${itemType} may not be filed as ${statementClass} — that is speculation recorded as fact`);
      continue;
    }

    // §9.2: thread relationships are not this task's to make.
    if ("threadId" in entry || "threadIds" in entry || "connections" in entry || "relatedItemIds" in entry) {
      fail("extraction may not propose thread relationships");
      continue;
    }

    const displayText = typeof entry.displayText === "string" ? entry.displayText.trim() : "";
    if (!displayText) { fail("empty displayText"); continue; }

    const normalizedLabel =
      typeof entry.normalizedLabel === "string" && entry.normalizedLabel.trim()
        ? entry.normalizedLabel.trim()
        : null;

    // --- Citation check. ---------------------------------------------------
    let sourceStart = typeof entry.sourceStart === "number" && Number.isInteger(entry.sourceStart) ? entry.sourceStart : null;
    let sourceEnd = typeof entry.sourceEnd === "number" && Number.isInteger(entry.sourceEnd) ? entry.sourceEnd : null;
    let sourceQuoteHash = typeof entry.sourceQuoteHash === "string" ? entry.sourceQuoteHash : null;

    if (sourceStart !== null && sourceEnd !== null) {
      const inBounds = sourceStart >= 0 && sourceEnd <= transcriptText.length && sourceStart < sourceEnd;
      // Re-read the span from the transcript and re-hash it. This is what makes
      // "do not invent offsets" checkable instead of hoped for.
      const matches = inBounds && sourceQuoteHash !== null
        ? quoteHash(transcriptText.slice(sourceStart, sourceEnd)) === sourceQuoteHash
        : false;
      if (!matches) {
        sourceStart = null;
        sourceEnd = null;
        sourceQuoteHash = null;
        droppedCitations++;
      }
    } else {
      // Half a citation is not a citation.
      sourceStart = null;
      sourceEnd = null;
      sourceQuoteHash = null;
    }

    // --- Numerics. ---------------------------------------------------------
    let numericFacts: NumericFact[] | undefined;
    if (Array.isArray(entry.numericFacts)) {
      numericFacts = [];
      for (const n of entry.numericFacts) {
        if (!isObject(n)) continue;
        if (typeof n.name !== "string" || typeof n.value !== "number" || !Number.isFinite(n.value)) continue;
        numericFacts.push({
          name: n.name,
          value: n.value,
          ...(typeof n.unit === "string" ? { unit: n.unit } : {}),
          ...(n.approximate === true ? { approximate: true } : {}),
        });
      }
      if (numericFacts.length === 0) numericFacts = undefined;
    }

    seen.add(tempId);
    items.push({
      tempId,
      itemType: itemType as ItemType,
      statementClass: statementClass as StatementClass,
      displayText,
      normalizedLabel,
      sourceStart,
      sourceEnd,
      sourceQuoteHash,
      ...(numericFacts ? { numericFacts } : {}),
    });
  }

  return { items, rejected, droppedCitations };
}
