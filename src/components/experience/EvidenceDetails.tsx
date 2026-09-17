import type { ProjectionMeta } from "@/lib/presentation/envelope";

// The version strings, out of the reading line and into a disclosure.
//
// The 17 September handoff, two layout rules that are really one:
//
//   "Move projection and policy versions into accessible evidence details."
//   "Keep routine metadata readable. Do not make it tiny or excessively
//    muted."
//
// AND THE COMPLAINT THEY CAME FROM, in the product owner's words: the screens
// are "very data heavy, very engineer geared, they dont use natural language".
// A person record printed `clinician_patient.v1+clinical-policy-2026-08-t1` in
// eleven-pixel monospace beside the patient's name, which is that sentence in
// one artefact. It is a build identifier. It is on the line a clinician reads
// to find out whose record this is and how current it is.
//
// SO IT IS NOT DELETED — IT IS MOVED AND LABELLED. The versions are the thing
// that settles an argument about a screenshot, and a version nobody can see
// settles nothing. What changes is that they cost a click instead of costing
// attention, they come with words saying what they are, and they are legible
// when opened rather than shrunk to fit somewhere they did not belong.
//
// ONE HOME, so the same six facts are not spelled six ways across the product.

export function EvidenceDetails({
  meta,
  label = "Evidence details",
  className = "",
}: {
  meta: ProjectionMeta;
  /** What the disclosure is called. Named rather than fixed because a
   *  screen with two projections has to distinguish them. */
  label?: string;
  className?: string;
}) {
  const rows: Array<[string, string]> = [
    ["Contract", meta.schemaVersion],
    ["Projection build", meta.projectionVersion],
    ["Policy", meta.policyVersion],
    ["Computed", meta.generatedAt],
    ["Newest source event", meta.sourceWatermark ?? "None recorded"],
  ];

  return (
    <details className={`text-sm ${className}`}>
      <summary className="cursor-pointer text-olive underline-offset-2 hover:underline">
        {label}
      </summary>
      {/* A <dl> whose only children are <dt> and <dd>, because the
          accessibility guard has already caught this shape once with wrapper
          divs between them — axe reported six definition-list violations on
          /review/status from exactly that. */}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([term, value]) => (
          <Row key={term} term={term} value={value} />
        ))}
      </dl>
      <p className="measure mt-2 text-olive">
        These identify the build and the rules that produced what is on this
        screen. They are here so a screenshot can be checked against the live
        record, and they say nothing about the person.
      </p>
    </details>
  );
}

/** A fragment, so the <dl> above has only <dt> and <dd> as children. */
function Row({ term, value }: { term: string; value: string }) {
  return (
    <>
      <dt className="text-olive">{term}</dt>
      {/* Monospace, because these are identifiers a reader compares character
          by character — and at the body size, because "do not make it tiny"
          is the rule that put them here. */}
      <dd className="font-mono text-ground">{value}</dd>
    </>
  );
}
