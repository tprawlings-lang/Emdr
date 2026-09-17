import { strict as assert } from "node:assert";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceDetails } from "../src/components/experience/EvidenceDetails";
import type { ProjectionMeta } from "../src/lib/presentation/envelope";

// The 17 September handoff's layout rule: "Move projection and policy versions
// into accessible evidence details."
//
// THE ARTEFACT IT NAMES was a person record printing
// `clinician_patient.v1+clinical-policy-2026-08-t1` in eleven-pixel monospace
// on the same line as the patient's name, their priority band and their
// consent state. The product owner's complaint in their own words: the screens
// are "very data heavy, very engineer geared, they dont use natural language".
//
// TWO THINGS HAVE TO HOLD AT ONCE and they pull against each other, which is
// why this is a test rather than a habit. The versions must not be on the
// reading line. They must also still be THERE — they are what settles an
// argument about whether a screenshot matches the live record, and a version
// nobody can reach settles nothing.

const META: ProjectionMeta = {
  schemaVersion: "clinician_patient.v1",
  projectionVersion: "proj-2026-09-17-a",
  generatedAt: "2026-09-17T21:00:00.000Z",
  tenantId: "T0000000000000000000000000",
  sourceWatermark: "2026-09-17T20:55:00.000Z",
  policyVersion: "clinical-policy-2026-08-t1",
};

/** Everything a reader sees before opening anything. */
function collapsedText(html: string): string {
  const withoutDetails = html.replace(/<details\b[\s\S]*?<\/details>/g, (block) => {
    const summary = block.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/);
    return summary ? summary[1] : "";
  });
  return withoutDetails.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("no version string is on screen before the disclosure is opened", () => {
  const html = renderToStaticMarkup(<EvidenceDetails meta={META} />);
  const visible = collapsedText(html);
  for (const version of [META.schemaVersion, META.projectionVersion, META.policyVersion]) {
    assert.ok(!visible.includes(version), `"${version}" is on the reading line: ${visible}`);
  }
  assert.equal(visible, "Evidence details");
});

test("every version is reachable, and labelled in words", () => {
  const html = renderToStaticMarkup(<EvidenceDetails meta={META} />);
  const all = text(html);
  // The values...
  for (const version of [
    META.schemaVersion, META.projectionVersion, META.policyVersion,
    META.generatedAt, META.sourceWatermark!,
  ]) {
    assert.ok(all.includes(version), `${version} is not in the disclosure at all`);
  }
  // ...and a word for each, because a bare identifier is the defect being
  // fixed rather than a smaller version of it.
  for (const term of ["Contract", "Projection build", "Policy", "Computed", "Newest source event"]) {
    assert.ok(all.includes(term), `${term} has no label`);
  }
});

test("a missing watermark is named, not left blank", () => {
  // §30.8's rule in miniature: absence is a state with a name. A blank cell
  // reads as "nothing to see" where the honest answer is "nothing recorded".
  const html = renderToStaticMarkup(
    <EvidenceDetails meta={{ ...META, sourceWatermark: null }} />
  );
  assert.ok(text(html).includes("None recorded"));
});

test("the disclosure is a native details, so it opens without JavaScript", () => {
  // A clinician reading a record with scripts blocked, and a screen reader in
  // browse mode, both reach the content. A div with an onClick does neither.
  const html = renderToStaticMarkup(<EvidenceDetails meta={META} />);
  assert.match(html, /<details\b/, "not a native disclosure");
  assert.match(html, /<summary\b/, "no summary to operate");
});

test("the definition list holds only terms and descriptions", () => {
  // Found by measurement once already: axe reported six definition-list and
  // sixty-four dlitem violations on /review/status, all serious, from wrapper
  // elements sitting between a <dl> and its <dt>/<dd>.
  const html = renderToStaticMarkup(<EvidenceDetails meta={META} />);
  const dl = html.match(/<dl\b[^>]*>([\s\S]*?)<\/dl>/);
  assert.ok(dl, "no definition list");
  const stripped = dl[1].replace(/<\/?d[td]\b[^>]*>/g, "").replace(/[^<]/g, "");
  assert.equal(stripped, "", `the list has children that are not <dt> or <dd>: ${dl[1]}`);
});

test("the label can be named, so two projections on one screen are distinguishable", () => {
  const html = renderToStaticMarkup(
    <EvidenceDetails meta={META} label="Evidence details for this queue" />
  );
  assert.ok(collapsedText(html).includes("Evidence details for this queue"));
});
