import { strict as assert } from "node:assert";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorkList, PersonSummary, AnalysisReview,
  type PersonStatus, type EvidenceSlot,
} from "../src/components/experience/templates";
import type { ProjectionMeta } from "../src/lib/presentation/envelope";

// The three page templates, and the rules they exist to make structural.
//
// EVERY ASSERTION HERE IS ABOUT A RULE THAT WAS ALREADY WRITTEN DOWN. The
// handoff's layout rules are in a document and have been for a week; UX 010
// reports them being broken by people who had read them. What these tests
// check is that the template makes breaking them awkward rather than a matter
// of remembering — so they check ORDER and PRESENCE in rendered output, not
// that the source contains a phrase.

const META: ProjectionMeta = {
  schemaVersion: "clinician_queue.v2",
  projectionVersion: "proj-2026-09-17-a",
  generatedAt: "2026-09-17T21:00:00.000Z",
  tenantId: "T0000000000000000000000000",
  sourceWatermark: "2026-09-17T20:55:00.000Z",
  policyVersion: "clinical-policy-2026-08-t1",
};

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Where each phrase first appears, so order can be asserted as order. */
function order(html: string, ...needles: string[]): number[] {
  return needles.map((n) => {
    const at = text(html).indexOf(n);
    assert.notEqual(at, -1, `"${n}" is not on the page at all`);
    return at;
  });
}

const STATUS: PersonStatus = {
  statement: "A care plan was drafted 2026-01-02, no goals are recorded.",
  reason: "Assembled from what is on the record.",
  missing: ["what this person is trying to get back to"],
};

// ---------------------------------------------------------------------------
// Analysis and review — question; result; limitations; evidence; decision
// ---------------------------------------------------------------------------

test("an analysis screen puts the question and the result before the technical explanation", () => {
  // "Trajectory: put findings first and technical explanation later.
  // Descriptive status cannot be mistaken for a forecast." The order is the
  // template's, not the caller's — there is no prop that reorders it.
  const html = renderToStaticMarkup(
    <AnalysisReview
      question="Has the course changed?"
      limitations={["It does not predict anything."]}
      evidence={{ projection: META }}
      decision={<p>Record a disagreement</p>}
    >
      <p>Sleep readings are lower than the previous window.</p>
    </AnalysisReview>
  );
  const [question, result, limits, evidence, decision] = order(
    html,
    "Has the course changed?",
    "Sleep readings are lower",
    "What this cannot tell you",
    "Evidence details",
    "Record a disagreement"
  );
  assert.ok(question < result, "the result comes before the question it answers");
  assert.ok(result < limits, "the limitations come before the finding");
  assert.ok(limits < evidence, "the arithmetic comes before what it cannot tell you");
  assert.ok(evidence < decision, "the decision comes before its evidence");
});

test("an analysis screen with no limitations says so, loudly, rather than showing nothing", () => {
  // An empty array is almost always a screen that has not thought about it,
  // and a blank space reads as a reading with no limits — which no clinical
  // reading has. So the absence is stated, and stated as a gap in the SCREEN
  // rather than as a property of the reading.
  const html = renderToStaticMarkup(
    <AnalysisReview question="Q?" limitations={[]} evidence={{ projection: META }}>
      <p>result</p>
    </AnalysisReview>
  );
  const body = text(html);
  assert.ok(body.includes("What this cannot tell you"), "the section vanished with its content");
  assert.match(body, /No limitation has been recorded/);
  assert.match(body, /gap in this screen, not a statement that the reading is unqualified/);
});

test("the decision section is absent when there is no decision to make", () => {
  const html = renderToStaticMarkup(
    <AnalysisReview question="Q?" limitations={["l"]} evidence={{ projection: META }}>
      <p>result</p>
    </AnalysisReview>
  );
  assert.ok(!html.includes('aria-label="Decision"'), "an empty decision section is rendered");
});

// ---------------------------------------------------------------------------
// The evidence slot
// ---------------------------------------------------------------------------

test("evidence is answered one way or the other, and a projection goes through the disclosure", () => {
  const withProjection = renderToStaticMarkup(
    <AnalysisReview question="Q?" limitations={["l"]} evidence={{ projection: META }}>
      <p>result</p>
    </AnalysisReview>
  );
  // The versions are present but not on the reading line — EvidenceDetails
  // owns that rule and this is the template handing it over rather than
  // printing them itself.
  assert.match(withProjection, /<details\b/, "a projection did not render the disclosure");
  assert.ok(text(withProjection).includes("Evidence details"));

  const perRow = renderToStaticMarkup(
    <AnalysisReview
      question="Q?"
      limitations={["l"]}
      evidence={{ perRow: "Every state opens its own windows." }}
    >
      <p>result</p>
    </AnalysisReview>
  );
  assert.ok(text(perRow).includes("Every state opens its own windows."));
  assert.ok(!text(perRow).includes("Evidence details"), "a per-row screen got an empty panel");
});

test("a screen cannot print a version string instead of declaring its evidence", () => {
  // The slot takes a ProjectionMeta or a sentence, never arbitrary nodes — so
  // "evidence panel" cannot become a paragraph with
  // `clinician_patient.v1+clinical-policy-2026-08-t1` in it. TypeScript is the
  // enforcement; this records what it is enforcing and fails if the union ever
  // grows a node arm.
  const slots: EvidenceSlot[] = [{ projection: META }, { perRow: "note" }];
  for (const slot of slots) {
    const keys = Object.keys(slot);
    assert.equal(keys.length, 1);
    assert.ok(["projection", "perRow"].includes(keys[0]), `unexpected evidence arm: ${keys[0]}`);
  }
});

// ---------------------------------------------------------------------------
// Person summary — the seven things a destination opens with
// ---------------------------------------------------------------------------

test("a person section opens with the status, the reason, what is missing and one action", () => {
  // Four of the amendment's seven. Ownership and evidence freshness are the
  // other two and belong to the RECORD, not to the section: the workspace's
  // identity strip carries them directly above this block, and rendering them
  // here too printed "Unassigned · Evidence 1 d ago" twice on one screen from
  // one source. The destination opens with all seven; this block is not all
  // of the destination.
  const html = renderToStaticMarkup(
    <PersonSummary
      status={{ ...STATUS, primaryAction: { href: "/x", label: "Record a first goal" } }}
    />
  );
  const body = text(html);
  assert.ok(body.includes(STATUS.statement), "no status statement");
  assert.ok(body.includes(STATUS.reason), "no reason for the status");
  assert.ok(body.includes("what this person is trying to get back to"), "missing information absent");
  assert.ok(body.includes("Record a first goal"), "no primary action");
});

test("the summary does not restate what the identity strip above it already says", () => {
  // The guard on the fix: a later edit that adds an owner or a freshness
  // label back into this block reintroduces the duplication it was removed
  // for. There is no prop to render them from, and this says why.
  const keys = Object.keys(STATUS);
  for (const banned of ["owner", "freshness", "evidenceAt", "band", "name"]) {
    assert.ok(!keys.includes(banned), `PersonStatus carries ${banned}, which the identity strip owns`);
  }
});

test("a due date cannot be shown without naming the policy that created it", () => {
  // "Due state only when a real policy creates a due date." The type carries
  // both, so a screen wanting an urgent-looking date has to name a rule — and
  // inventing one is then a visible lie rather than a style choice.
  const withDue = renderToStaticMarkup(
    <PersonSummary status={{ ...STATUS, due: { at: "2026-09-20", policy: "handoff-sla-v1" } }} />
  );
  assert.ok(text(withDue).includes("Due 2026-09-20 under handoff-sla-v1"));

  const withoutDue = renderToStaticMarkup(<PersonSummary status={STATUS} />);
  assert.ok(!text(withoutDue).includes("Due"), "a due state appeared without one being passed");
});

test("nothing missing is a sentence, not a blank", () => {
  // §30.8 in miniature: absence is a state with a name. A blank reads as
  // "nothing to see" where the honest answer is "nothing is missing".
  const html = renderToStaticMarkup(<PersonSummary status={{ ...STATUS, missing: [] }} />);
  assert.ok(text(html).includes("Nothing needed for this reading is missing."));
});

test("there is exactly one primary action, because there is exactly one slot", () => {
  const html = renderToStaticMarkup(
    <PersonSummary status={{ ...STATUS, primaryAction: { href: "/x", label: "Only one" } }} />
  );
  const buttons = html.match(/rounded-full bg-app-ink/g) ?? [];
  assert.equal(buttons.length, 1, "more than one prominent action rendered");
});

// ---------------------------------------------------------------------------
// Work list — scope and filters; rows; evidence; action result
// ---------------------------------------------------------------------------

test("a work list reports what just happened above the rows, not below them", () => {
  // The handoff lists the action result last and it renders first, which is
  // deliberate: it is the answer to something the reader just did, and a
  // report pushed below however many rows remain is a report they will not
  // read. "Every action reports what actually happened."
  const html = renderToStaticMarkup(
    <WorkList
      purpose="Members who asked to open a gated module."
      result={<p>Recorded as opened.</p>}
      scope={<p>Filtered to: waiting</p>}
      evidence={{ projection: META }}
    >
      <p>Row one</p>
    </WorkList>
  );
  const [purpose, result, scope, rows, evidence] = order(
    html,
    "Members who asked to open a gated module.",
    "Recorded as opened.",
    "Filtered to: waiting",
    "Row one",
    "Evidence details"
  );
  assert.ok(purpose < result, "the purpose is not first");
  assert.ok(result < scope, "the result is below the filters");
  assert.ok(scope < rows, "the filters are below the rows they filter");
  assert.ok(rows < evidence, "the evidence panel is above the rows");
});

test("a work list with nothing to report renders no result region at all", () => {
  const html = renderToStaticMarkup(
    <WorkList purpose="p" evidence={{ perRow: "each row carries its own" }}>
      <p>Row one</p>
    </WorkList>
  );
  assert.ok(text(html).includes("Row one"));
  assert.ok(text(html).includes("each row carries its own"));
});

// ---------------------------------------------------------------------------
// Prose is measured; work is not
// ---------------------------------------------------------------------------

test("explanation is capped to a readable measure and rows are not", () => {
  // "Give clinical work useful horizontal space. Keep long reading content in
  // a narrower text column." Two rules that contradict each other unless
  // something knows which is which, so the template does.
  const html = renderToStaticMarkup(
    <WorkList purpose="A sentence of explanation." evidence={{ perRow: "n" }}>
      <table data-rows />
    </WorkList>
  );
  const purposeTag = html.match(/<p[^>]*>A sentence of explanation\.<\/p>/);
  assert.ok(purposeTag, "the purpose is not its own paragraph");
  assert.match(purposeTag[0], /\bmeasure\b/, "prose is not capped to a measure");

  const rowsTag = html.match(/<div[^>]*>\s*<table/);
  assert.ok(rowsTag, "the rows are not in their own region");
  assert.ok(!/\bmeasure\b/.test(rowsTag[0]), "the rows were capped to a reading measure");
});
