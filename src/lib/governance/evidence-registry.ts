// One place every public claim comes from (17 September handoff, P5).
//
// THE FINDING THIS ANSWERS is about somebody else's product and lands squarely
// on this one: "research and service-evaluation material is easy to find, but
// public study counts vary between pages." Two pages quoting the same body of
// work and disagreeing about how much of it there is. The instruction is
// "generate every public claim and count from one governed evidence registry"
// and "do not maintain separate numbers in page copy".
//
// STEADY HAD THE SAME SHAPE OF PROBLEM, in miniature. The public evidence page
// carried claims as three fields — claim, support, runnable — with counts
// written into the prose: "twelve attack cases", "eighteen isolation cases and
// twelve transaction cases". Those numbers were right when typed and nothing
// checks them. A test added tomorrow makes a public page wrong, silently, and
// the only person who would notice is a reader counting.
//
// SO A CLAIM IS A RECORD, NOT A SENTENCE. It names what product and version it
// is about, which population, what kind of evidence it rests on, what it cannot
// support, which surfaces may show it, who approved it and when that approval
// stops. A number inside the text names the source that produces it.
//
// AND IT FAILS CLOSED. An unapproved claim, an expired one, or one rendered on
// a surface it was not approved for does not render. "Do not silently extend
// approval" is the whole point: an attestation that cannot lapse is one nobody
// has to maintain, which is the same failure as one nobody made.

/**
 * What kind of thing a claim rests on.
 *
 * THE HANDOFF NAMES FOUR and they are about clinical and operational evidence:
 * research, service evaluation, fabricated demonstration, product telemetry.
 * Most of Steady's public claims are none of those — they are statements about
 * software behaviour backed by a command anybody can run. Folding those into
 * "product telemetry" would describe a passing test suite as operational data
 * about real use, which is the exact category error the whole page exists to
 * prevent, so they get their own type and this comment says why.
 */
export type EvidenceType =
  | "research"
  | "service_evaluation"
  | "fabricated_demonstration"
  | "product_telemetry"
  | "software_verification"
  /**
   * A claim that nothing exists.
   *
   * IT NEEDED ITS OWN TYPE because the rendered page said "Published research ·
   * about Steady" over the sentence "that evidence does not transfer to
   * Steady" — a claim about the ABSENCE of research, labelled as research about
   * the product. On the one page whose whole job is keeping method evidence
   * and product evidence apart, that is the worst possible label.
   */
  | "absence_of_evidence";

export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = {
  research: "Published research",
  service_evaluation: "Service evaluation",
  fabricated_demonstration: "Fabricated demonstration",
  product_telemetry: "Product telemetry",
  software_verification: "Runnable check in this repository",
  absence_of_evidence: "No evidence exists",
};

export type ApprovalStatus = "approved" | "draft" | "withdrawn";

/** A number inside a claim's text, and the thing that produces it. */
export interface CountedFrom {
  /** What the public text says. */
  count: number;
  /** A repository path the count is taken from. */
  source: string;
  /** How to count it, so a guard and a reader agree. */
  how: string;
}

export interface EvidenceClaim {
  claimId: string;
  /** The exact words a surface may show. Nothing paraphrases a claim. */
  publicText: string;
  /** What the claim is ABOUT. "EMDR as practised by clinicians" is not Steady,
   *  and the distinction is the single most important field here. */
  productScope: string;
  productVersion: string;
  /** Who it is about. "Nobody — fabricated" is a real answer. */
  population: string;
  evidenceType: EvidenceType;
  /** Commands, files or documents somebody can go and check. */
  sourceIds: string[];
  resultSummary: string;
  /** What it cannot support. Required: a claim with no stated limit is a claim
   *  somebody will stretch. */
  limitations: string;
  /** Routes this may appear on. A claim approved for the trust page is not
   *  thereby approved for a payer deck. */
  allowedSurfaces: string[];
  approvalStatus: ApprovalStatus;
  approvedBy?: string;
  /** YYYY-MM-DD. */
  reviewedAt?: string;
  /** YYYY-MM-DD. Absent means it does not lapse on a date — not that it is
   *  approved for ever; `approvalStatus` still governs. */
  expiresAt?: string;
  countedFrom?: CountedFrom;
}

export interface ClaimResolution {
  ok: boolean;
  /** Why not, in words an author can act on. Empty when ok. */
  refusals: string[];
}

/**
 * Whether a claim may be shown, here, now.
 *
 * FAILS CLOSED on every branch. The alternative — render it and log a warning —
 * puts an unapproved or lapsed claim in front of a reader, which is the harm;
 * a missing sentence on a page is an inconvenience.
 */
export function resolveClaim(
  claim: EvidenceClaim, args: { surface: string; asOf: string }
): ClaimResolution {
  const refusals: string[] = [];

  if (claim.approvalStatus !== "approved") {
    refusals.push(`${claim.claimId} is ${claim.approvalStatus}, so it is not published anywhere.`);
  }
  if (!claim.reviewedAt) {
    refusals.push(`${claim.claimId} carries no review date, so nobody can say when it was checked.`);
  }
  if (!claim.approvedBy) {
    refusals.push(`${claim.claimId} names nobody who approved it.`);
  }
  if (claim.expiresAt && args.asOf.slice(0, 10) > claim.expiresAt) {
    // NOT "expired, showing anyway". §: "Remove or mark expired claims
    // automatically at render time. Do not silently extend approval."
    refusals.push(
      `${claim.claimId} expired on ${claim.expiresAt} and today is ${args.asOf.slice(0, 10)}. ` +
      "It needs reviewing again, not extending."
    );
  }
  if (!claim.allowedSurfaces.includes(args.surface)) {
    refusals.push(
      `${claim.claimId} is approved for ${claim.allowedSurfaces.join(", ") || "no surface"} ` +
      `and this is ${args.surface}.`
    );
  }
  if (!claim.limitations.trim()) {
    refusals.push(`${claim.claimId} states no limitation, and a claim with no limit gets stretched.`);
  }

  return { ok: refusals.length === 0, refusals };
}

/** The claims a surface may render, and the ones it may not, with reasons. */
export function claimsFor(
  claims: readonly EvidenceClaim[], args: { surface: string; asOf: string }
): { shown: EvidenceClaim[]; withheld: Array<{ claim: EvidenceClaim; refusals: string[] }> } {
  const shown: EvidenceClaim[] = [];
  const withheld: Array<{ claim: EvidenceClaim; refusals: string[] }> = [];
  for (const claim of claims) {
    const r = resolveClaim(claim, args);
    if (r.ok) shown.push(claim);
    else withheld.push({ claim, refusals: r.refusals });
  }
  return { shown, withheld };
}

// ---------------------------------------------------------------------------
// The claims
// ---------------------------------------------------------------------------

const TRUST = "/trust";
const EVIDENCE = "/evidence";
const PRODUCT_VERSION = "steady-pilot-2026-09";
const REVIEWED = "2026-09-18";
const APPROVER = "Steady product owner";

export const EVIDENCE_CLAIMS: readonly EvidenceClaim[] = [
  // --- What the method has, and what does not transfer -------------------
  {
    claimId: "method.emdr-has-published-support",
    publicText:
      "EMDR delivered by trained clinicians has published support for post-traumatic stress.",
    // THE FIELD THAT MATTERS MOST ON THIS CLAIM. It is about the method as
    // clinicians practise it. It is not about this product, and a registry that
    // could not say so would be a machine for laundering method evidence into
    // product evidence.
    productScope: "EMDR as practised by trained clinicians — not Steady",
    productVersion: "not applicable",
    population: "People treated for post-traumatic stress in published studies",
    evidenceType: "research",
    sourceIds: ["Published research and clinical practice guidelines"],
    resultSummary: "Published research and guidelines describe clinician-delivered EMDR.",
    limitations:
      "This is evidence about a method practised by a clinician. It says nothing about software, " +
      "about Steady, or about anything delivered between visits.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
  {
    claimId: "method.does-not-transfer",
    publicText: "That evidence does not transfer to Steady.",
    productScope: "Steady",
    productVersion: PRODUCT_VERSION,
    population: "Nobody — no study evaluates Steady",
    evidenceType: "absence_of_evidence",
    sourceIds: ["The absence of any study evaluating Steady"],
    resultSummary:
      "Steady is software delivering structured self-guided experiences between visits. No " +
      "published study evaluates it.",
    limitations:
      "This is a statement about what is absent. It is not a finding that Steady does not work; " +
      "it is that nobody has looked.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },

  // --- What a command can show ------------------------------------------
  {
    claimId: "software.access-deterministic",
    publicText: "Access decisions are deterministic and reproducible.",
    productScope: "Steady access gate chain",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["npm run test:safety"],
    resultSummary: "The safety suite covers the ordered gate chain and its rules.",
    limitations:
      "A passing suite shows the rules behave as written. It is not evidence that the rules are " +
      "clinically right.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
  {
    claimId: "software.replayable",
    publicText: "History can be rebuilt from the event log without drift.",
    productScope: "Steady event log and projections",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["npm run demo -- verify"],
    resultSummary:
      "A reset produces a reproducible baseline, the backfill is idempotent, and projections " +
      "rebuild byte-identically.",
    limitations: "It shows the rebuild is faithful, not that what was recorded was correct.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
  {
    claimId: "software.rls-denies-cross-tenant",
    publicText: "Cross-tenant access is denied at the database layer.",
    productScope: "Steady storage layer",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["npm run test:rls", "tests/rls.test.ts"],
    resultSummary: "Attack cases run against a real Postgres cluster, and the job blocks the build.",
    limitations:
      "It covers the cases written. A layer that denies the tested attacks has not been proven " +
      "to deny every attack.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
  {
    claimId: "software.app-denies-cross-tenant",
    // THE COUNT COMES OUT OF THE TEXT AND INTO THE RECORD. It read "Eighteen
    // isolation cases and twelve transaction cases" — right when typed, checked
    // by nobody, and wrong the moment somebody adds a test.
    publicText: "Cross-tenant access is denied at the application layer.",
    productScope: "Steady application layer",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["tests/tenant-isolation.test.ts"],
    resultSummary: "Isolation cases cover the paths a request can take to another tenant's record.",
    limitations:
      "It covers the cases written, against this application's own code paths. It is not a " +
      "penetration test.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
    countedFrom: {
      count: 18,
      source: "tests/tenant-isolation.test.ts",
      how: "Top-level `test(` declarations in the file.",
    },
  },
  {
    claimId: "software.no-uncitable-summary",
    publicText: "Clinical summaries cannot display an uncitable claim.",
    productScope: "Steady clinical summary",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["npm run test:safety"],
    resultSummary: "A summary statement with no resolvable evidence is dropped and the drop reported.",
    limitations:
      "A citable statement is not a correct one. This is about whether a claim can be opened, " +
      "not whether it is right.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
  {
    claimId: "software.no-silent-retail-claims",
    publicText: "Public pages cannot silently regain retail or compliance claims.",
    productScope: "Steady public site",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["npm run test:safety"],
    resultSummary: "A banned-vocabulary guard fails the build on a reintroduced claim.",
    limitations: "It catches the words on the list. A new way of saying the same thing is not on it.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
  {
    claimId: "software.automated-accessibility",
    publicText: "The interface meets automated accessibility checks.",
    productScope: "Steady interface",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["npm run test:a11y"],
    resultSummary: "Automated checks pass across the audited routes.",
    limitations:
      "Automated checks find a minority of accessibility problems. No disabled person has tested " +
      "this, and that is the evidence that would matter.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },

  // --- The held workstream ----------------------------------------------
  {
    claimId: "bls.validation-workstream",
    publicText:
      "Bilateral stimulation Part 6 is an active validation workstream, not a shipped feature.",
    productScope: "Steady bilateral stimulation",
    productVersion: PRODUCT_VERSION,
    population: "Nobody — nothing is delivered to anyone",
    evidenceType: "fabricated_demonstration",
    sourceIds: ["/review/bls"],
    resultSummary: "The oversight console shows the workstream's state and what it is waiting on.",
    limitations: "A workstream is not a finding. Nothing here says the feature works.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
  {
    claimId: "bls.autonomous-off",
    publicText: "Autonomous stimulation is off, and no configuration can turn it on.",
    productScope: "Steady bilateral stimulation",
    productVersion: PRODUCT_VERSION,
    population: "Not applicable — a property of the software",
    evidenceType: "software_verification",
    sourceIds: ["npm run test:safety"],
    resultSummary: "No deployment setting enables it, and a guard fails the build if one appears.",
    limitations: "It is a statement about this build's configuration surface, not about a future one.",
    allowedSurfaces: [TRUST, EVIDENCE],
    approvalStatus: "approved",
    approvedBy: APPROVER,
    reviewedAt: REVIEWED,
  },
];

/** A claim by id, or null. Never throws: a surface asking for a claim that no
 *  longer exists gets nothing rather than a crash, and the guard catches the
 *  dangling reference at build time. */
export function claimById(id: string): EvidenceClaim | null {
  return EVIDENCE_CLAIMS.find((c) => c.claimId === id) ?? null;
}
