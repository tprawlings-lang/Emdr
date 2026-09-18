// The payer console's four questions, answered (17 September handoff, P5).
//
// Same discipline as the organization console: every figure is read off a
// projection that already computes it, so the summary and the table underneath
// cannot disagree, and each answer carries its denominator, window, missingness
// and definition.
//
// THE PAYER'S FOUR ARE ORDERED AS A CHAIN, and the order is the point. Who was
// eligible fixes the denominator; who participated is measured against it; what
// was measured says which contract terms could be computed at all; and how
// mature the evidence is says whether any of the three should be quoted yet. A
// console that answered the fourth first would be telling somebody how complete
// a picture is before showing them the picture.

import type { Envelope } from "../presentation/envelope";
import {
  loadContract, buildPayerPathway, buildContractReport, buildDataQuality,
  type PayerContract, type PayerPathway, type ContractReport, type DataQuality,
} from "../intelligence/payer";
import {
  questionsFor, assertTraceable, unanswered, type TracedAnswer,
} from "./opening-questions";

const pct = (n: number, of: number) => (of === 0 ? "—" : `${Math.round((n / of) * 100)}%`);
const withDenominator = (n: number, of: number) =>
  `${pct(n, of)} (${n.toLocaleString()} / ${of.toLocaleString()})`;

function whyMissing(e: Envelope<unknown> | null): string | null {
  const missing = e?.missing?.map((m) => `${m.source}: ${m.reason}`).join(" ");
  return missing ?? e?.reason ?? null;
}

export async function payerAnswers(payerTenantId: string): Promise<TracedAnswer[]> {
  const [contract, pathway, report, quality] = await Promise.all([
    loadContract(payerTenantId),
    buildPayerPathway(payerTenantId).catch(() => null),
    buildContractReport(payerTenantId).catch(() => null),
    buildDataQuality(payerTenantId).catch(() => null),
  ]);
  const [qEligible, qParticipated, qMeasured, qMaturity] = questionsFor("payer");

  return [
    eligibleAnswer(contract, pathway, qEligible),
    participatedAnswer(pathway, qParticipated),
    measuredAnswer(report, qMeasured),
    maturityAnswer(quality, qMaturity),
  ];
}

function eligibleAnswer(
  contract: PayerContract | null,
  pathway: Envelope<PayerPathway> | null,
  q: ReturnType<typeof questionsFor>[number],
): TracedAnswer {
  const eligible = pathway?.data?.stages.find((s) => s.label === "Eligible");
  if (!contract || !eligible) {
    return unanswered(q, {
      because: whyMissing(pathway) ?? "No contracted population is loaded for this plan.",
      evidenceHref: "/payer/cohorts",
      evidenceLabel: "Open the cohort definition",
    });
  }
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      `${eligible.count.of.toLocaleString()} people were in the contracted cohort for ` +
      `${contract.periodStart} to ${contract.periodEnd}, under cohort rules ${contract.cohortVersion}.`,
    figure: eligible.count.of.toLocaleString(),
    denominator:
      "This IS the denominator. Every figure on this console is counted against it, not against " +
      "the stage before it.",
    window: `${contract.periodStart} to ${contract.periodEnd}, as the contract defines the period.`,
    missingness:
      "Somebody eligible under the plan's own rules but absent from the file loaded here is not " +
      "counted. The cohort is what was delivered, not what the plan believes it covers.",
    definition:
      `Distinct people in cohort version ${contract.cohortVersion}. Exclusions are part of that ` +
      "version rather than applied afterwards, so two reports under the same version match.",
    evidenceHref: "/payer/cohorts",
    evidenceLabel: "Open the cohort definition",
  });
}

function participatedAnswer(
  pathway: Envelope<PayerPathway> | null, q: ReturnType<typeof questionsFor>[number],
): TracedAnswer {
  const p = pathway?.data;
  if (!p) {
    return unanswered(q, {
      because: whyMissing(pathway) ?? "The access pathway could not be read.",
      evidenceHref: "/payer/population-access",
      evidenceLabel: "Open the pathway",
    });
  }
  const started = p.stages.find((s) => s.label === "Started care");
  // THE TRANSITION, NOT THE STAGE. Naming only the stage produced "68% of the
  // cohort started care, and the largest fall is at started care" — a sentence
  // that reports a loss at the stage it has just counted, and reads as a
  // contradiction on the screen. The fall happens BETWEEN two stages, and
  // saying which two is the whole use of it.
  const dropIndex = p.stages.findIndex((s) => s.attention);
  const fell = dropIndex > 0
    ? { from: p.stages[dropIndex - 1].label, to: p.stages[dropIndex].label }
    : null;
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      `${withDenominator(started?.count.n ?? 0, started?.count.of ?? 0)} of the cohort started care` +
      (fell
        ? `, and most are lost between ${fell.from.toLowerCase()} and ${fell.to.toLowerCase()}.`
        : ".") +
      (p.medianTimeToCareDays === null
        ? " No referral-to-start interval could be computed."
        : ` The typical wait from referral to starting care is ${p.medianTimeToCareDays} days.`),
    figure: started ? withDenominator(started.count.n, started.count.of) : null,
    denominator: `${(started?.count.of ?? 0).toLocaleString()} eligible people, the contracted cohort.`,
    window: "The whole record for this contract, not the reporting period alone.",
    missingness:
      "Care started outside Steady is not here. A person who began treatment elsewhere counts as " +
      "not started, which understates participation rather than overstating it.",
    definition:
      "Distinct people reaching each stage at least once. Somebody contacted four times counts " +
      "once, at the furthest stage they reached.",
    evidenceHref: "/payer/population-access",
    evidenceLabel: "Open the pathway",
  });
}

/**
 * What was measured, and what was not.
 *
 * WITHHELD MEASURES ARE NAMED, NOT COUNTED AND DROPPED. "3 of 5 computed"
 * tells a plan executive that two are missing and nothing about which two, and
 * a measure with no number and no name reads as one nobody cared about. Pure
 * and exported so the naming is a behaviour a test can hold rather than a
 * sentence somebody has to re-read.
 */
export function measuredSentence(
  measures: ReadonlyArray<{ label: string; observed: number | null }>
): string {
  const computed = measures.filter((m) => m.observed !== null);
  const withheld = measures.filter((m) => m.observed === null);
  return (
    `${computed.length} of ${measures.length} contract measures could be computed from complete data.` +
    (withheld.length > 0
      ? ` The rest are blank with a reason each: ${withheld.map((m) => m.label).join(", ")}.`
      : " None is withheld.")
  );
}

function measuredAnswer(
  report: Envelope<ContractReport> | null, q: ReturnType<typeof questionsFor>[number],
): TracedAnswer {
  const r = report?.data;
  if (!r) {
    return unanswered(q, {
      because: whyMissing(report) ?? "No contract measures are loaded for this plan.",
      evidenceHref: "/payer/contract",
      evidenceLabel: "Open the contract report",
    });
  }
  const computed = r.measures.filter((m) => m.observed !== null);
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer: measuredSentence(r.measures),
    figure: `${computed.length} / ${r.measures.length}`,
    // THE CONTRACT'S NAME, NOT ITS KEY. This printed the row id — a database
    // key in front of a plan executive, which is the buyer-side version of the
    // policy version the member's Today was showing.
    denominator: `${r.measures.length} measures named in the ${r.contract.name} contract.`,
    window: `${r.contract.periodStart} to ${r.contract.periodEnd}, complete months only.`,
    missingness:
      "A measure computed from a partial month is not shown at all. A blank here is a month that " +
      "has not finished arriving, not a result of zero.",
    definition:
      "Each measure is the contract's own definition, computed against the cohort. The target " +
      "beside it is the contract's, not a benchmark Steady chose.",
    evidenceHref: "/payer/contract",
    evidenceLabel: "Open the contract report",
  });
}

function maturityAnswer(
  quality: Envelope<DataQuality> | null, q: ReturnType<typeof questionsFor>[number],
): TracedAnswer {
  const d = quality?.data;
  if (!d) {
    return unanswered(q, {
      because: whyMissing(quality) ?? "No claims have been received for this contract.",
      evidenceHref: "/payer/data-quality",
      evidenceLabel: "Open data quality",
    });
  }
  const late = d.observedLagDays !== null && d.observedLagDays > d.expectedLagDays;
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      (d.observedLagDays === null
        ? "No claims lag could be observed. "
        : `Claims arrive ${d.observedLagDays} days after service against a contract expectation of ` +
          `${d.expectedLagDays}${late ? " — running late" : ""}. `) +
      (d.incompleteMonths.length === 0
        ? "Every month in the period has finished arriving."
        : `${d.incompleteMonths.length} month${d.incompleteMonths.length === 1 ? "" : "s"} ` +
          `${d.incompleteMonths.length === 1 ? "has" : "have"} not finished arriving and ` +
          `${d.incompleteMonths.length === 1 ? "is" : "are"} excluded from every measure.`),
    figure: d.observedLagDays === null ? null : `${d.observedLagDays} days`,
    denominator: `${d.total.toLocaleString()} claims received for this contract.`,
    window: "All claims received to date. The lag is a median, not a maximum.",
    missingness:
      d.incompleteMonths.length === 0
        ? "No month is excluded. A claim that never arrives is invisible here by definition."
        : `Excluded months: ${d.incompleteMonths.join(", ")}. A claim that never arrives is ` +
          "invisible here by definition.",
    definition:
      `Days between service and receipt, against cohort version ${d.cohortVersion}. It describes ` +
      "the feed, not the care.",
    evidenceHref: "/payer/data-quality",
    evidenceLabel: "Open data quality",
  });
}
