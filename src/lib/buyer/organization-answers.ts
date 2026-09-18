// The organization console's three questions, answered (17 September handoff,
// P5).
//
// Each answer comes from a projection that already existed and already carried
// its denominator. What was missing was the question: a reader wanting to know
// where access is delayed had to open the funnel, find the largest drop
// themselves, and hold it against a median on another tile.
//
// NOTHING HERE COMPUTES A NEW NUMBER. Every figure below is read off an
// existing projection, so the answer and the chart underneath it cannot
// disagree — which is the failure mode of a summary written beside the thing it
// summarises.

import type { Envelope } from "../presentation/envelope";
import {
  buildOrgOverview, buildOrgCapacity, buildOrgSafetyOps,
  type OrgOverview, type OrgCapacity, type OrgSafetyOps,
} from "../intelligence/organization";
import { SMALL_CELL } from "@/components/charts/aggregate";
import {
  questionsFor, assertTraceable, unanswered, type TracedAnswer,
} from "./opening-questions";

const pct = (n: number, of: number) => (of === 0 ? "—" : `${Math.round((n / of) * 100)}%`);
const withDenominator = (n: number, of: number) =>
  `${pct(n, of)} (${n.toLocaleString()} / ${of.toLocaleString()})`;

/** The stage that loses the most people, and how many it loses. */
function largestDrop(o: OrgOverview): { label: string; lost: number; from: string } | null {
  let worst: { label: string; lost: number; from: string } | null = null;
  for (let i = 1; i < o.funnel.length; i++) {
    const lost = o.funnel[i - 1].count.n - o.funnel[i].count.n;
    if (!worst || lost > worst.lost) {
      worst = { label: o.funnel[i].label, lost, from: o.funnel[i - 1].label };
    }
  }
  return worst;
}

export async function organizationAnswers(orgTenantId: string): Promise<TracedAnswer[]> {
  const [overview, capacity, safety] = await Promise.all([
    buildOrgOverview(orgTenantId),
    buildOrgCapacity(orgTenantId).catch(() => null),
    buildOrgSafetyOps(orgTenantId).catch(() => null),
  ]);
  const [qAccess, qWork, qPolicy] = questionsFor("organization");

  return [
    accessAnswer(overview, qAccess),
    workAnswer(capacity, qWork),
    policyAnswer(safety, qPolicy),
  ];
}

function accessAnswer(
  envelope: Envelope<OrgOverview>, q: ReturnType<typeof questionsFor>[number]
): TracedAnswer {
  const o = envelope.data;
  if (!o) {
    return unanswered(q, {
      because: envelope.reason ?? "The access projection could not be read.",
      evidenceHref: "/organization/access",
      evidenceLabel: "Open the access pathway",
    });
  }
  const drop = largestDrop(o);
  const referrals = o.funnel[0].count.of;
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer: drop
      ? `Most people are lost between ${o.funnel.find((s) => s.label === drop.from)!.label.toLowerCase()} ` +
        `and ${drop.label.toLowerCase()}: ${drop.lost.toLocaleString()} of ${referrals.toLocaleString()} referrals stop there. ` +
        (o.firstContactDays === null
          ? "No first-contact interval could be computed."
          : `The typical wait from referral to first contact is ${o.firstContactDays} days.`)
      : "The access pathway has no stages to compare.",
    figure: drop ? withDenominator(drop.lost, referrals) : null,
    denominator: `${referrals.toLocaleString()} referrals received. Every stage is counted against that same number, not against the stage before it.`,
    window: "The whole record for this organization. The window control changes first contact only.",
    missingness:
      "People referred outside this organization's tenants are not counted, and a stage with no " +
      "recorded event is counted as not reached rather than as unknown.",
    definition:
      "Distinct people, not events. Somebody contacted three times counts once, at the furthest " +
      "stage they reached.",
    evidenceHref: "/organization/access",
    evidenceLabel: "Open the access pathway",
  });
}

function workAnswer(
  envelope: Envelope<OrgCapacity> | null, q: ReturnType<typeof questionsFor>[number]
): TracedAnswer {
  const c = envelope?.data;
  if (!c || c.ratio.length === 0) {
    // THE REASON COMES FROM THE ENVELOPE, NOT FROM A GUESS.
    //
    // The first version of this said "no site has enough waiting people to
    // report a demand figure without identifying them" — a plausible sentence
    // about small-cell suppression, and wrong. The projection returns `partial`
    // with demand for four sites and no supply at all: the scheduling system
    // has no slot record, so the ratio cannot be computed from half of it. A
    // console that invents why it cannot answer is worse than one that does not
    // answer, because the invented reason is the thing a reader acts on.
    const missing = envelope?.missing?.map((m) => `${m.source}: ${m.reason}`).join(" ");
    return unanswered(q, {
      because:
        missing ??
        envelope?.reason ??
        "The demand and capacity projection could not be read.",
      evidenceHref: "/organization/capacity",
      evidenceLabel: "Open demand and capacity",
    });
  }
  const worst = [...c.ratio].sort((a, b) => b.value - a.value)[0];
  const demand = c.demand.find((d) => d.label === worst.label);
  const supply = c.supply.find((s) => s.label === worst.label);
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      `Work is heaviest at ${worst.label}, where ${demand?.value.toLocaleString() ?? "—"} people are waiting ` +
      `against ${supply?.value.toLocaleString() ?? "—"} clinicians.`,
    figure: `${worst.value.toFixed(1)} waiting per clinician`,
    denominator: `${supply?.value.toLocaleString() ?? "—"} clinicians recorded at ${worst.label}.`,
    window: `Current queue, not a period. The slowest site's reading is ${c.feedAgeDays} days old.`,
    missingness:
      c.withheldSites > 0
        ? `${c.withheldSites} site${c.withheldSites === 1 ? "" : "s"} had fewer than ${SMALL_CELL} people waiting and ` +
          "are withheld rather than drawn short, so a small site cannot be identified from a bar."
        : `No site was withheld: every one had at least ${SMALL_CELL} people waiting.`,
    definition:
      "People waiting for a first appointment, over clinicians with any recorded activity at that " +
      "site. It is a ratio of counts, not a caseload standard.",
    evidenceHref: "/organization/capacity",
    evidenceLabel: "Open demand and capacity",
  });
}

function policyAnswer(
  envelope: Envelope<OrgSafetyOps> | null, q: ReturnType<typeof questionsFor>[number]
): TracedAnswer {
  const s = envelope?.data;
  if (!s) {
    return unanswered(q, {
      because: envelope?.reason ?? "No safety gate has fired for this organization.",
      evidenceHref: "/organization/safety",
      evidenceLabel: "Open safety operations",
    });
  }
  const { n, of } = s.responded;
  return assertTraceable({
    questionId: q.id,
    question: q.question,
    answer:
      `${withDenominator(n, of)} of safety gates that fired have a recorded response. ` +
      // NOT "compliance". A response rate says what was recorded, and a gate
      // with no recorded response is not thereby a gate nobody answered.
      "A gate with no recorded response is one nobody wrote down, which is not the same as one nobody answered.",
    figure: withDenominator(n, of),
    denominator: `${of.toLocaleString()} gates fired across this organization.`,
    window: "The whole record. Monthly volumes are on the safety screen.",
    missingness:
      "A month with fewer than eleven gates is withheld from the monthly chart, and a response " +
      "recorded outside Steady is not here at all.",
    definition:
      "A fixed rule firing, and a clinician action recorded against it. Neither is a judgement " +
      "about whether the response was right.",
    evidenceHref: "/organization/safety",
    evidenceLabel: "Open safety operations",
  });
}
