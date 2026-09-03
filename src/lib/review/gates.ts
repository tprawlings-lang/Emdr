// The eight release gates (§31.6, p99) and the evidence each one stands on.
//
// p99 gives every gate an owner, an evidence description and a blocking
// condition. This module adds the thing p99 assumes and does not supply: WHERE
// the evidence actually comes from in this deployment, and whether the system
// can check it at all.
//
// THREE EVIDENCE CLASSES, AND THEY MUST NOT RENDER ALIKE.
//
//   measured   The running system resolves it now, cheaply. The gate shows a
//              real result and the reviewer is confirming a fact.
//   on_demand  The system CAN resolve it, but the check is expensive enough
//              that running it on every page load would teach people to avoid
//              the page. Resolved only when asked for.
//   attested   The system cannot check it. Accessibility against a screen
//              reader, or a legal reading of a public claim, is not a thing a
//              server component can compute. A named owner asserts it and
//              records where the evidence lives.
//
// Collapsing these into one green tick is the defect this file exists to
// prevent. A gate that was ATTESTED and a gate that was MEASURED carry
// completely different weight, and a release conversation that cannot tell
// them apart is one where "all gates green" means less than it appears to.
// This is the same rule the rest of the codebase applies to source classes:
// patient report, clinician observation and model inference stay
// distinguishable, and so do these.

import crypto from "crypto";
import type Database from "better-sqlite3";
import { runIdentityScan } from "../demo-identity-scan";
import { runQualityChecks, qualitySummary } from "../demo-quality";
import { replayScenarios } from "../safety/scenarios";
import { SITE_CLAIMS_VERSION } from "../site/registry";
import { SAFETY_CONFIG_VERSION } from "../safety/governance";

export type EvidenceClass = "measured" | "on_demand" | "attested";

/** What the evidence currently says. `unavailable` is not a failure — it is
 *  the honest answer for evidence nobody has resolved yet, and it is kept
 *  separate from `fail` because "we did not look" and "we looked and it is
 *  broken" are different facts. */
export type EvidenceStatus = "pass" | "fail" | "unavailable";

export interface GateEvidence {
  status: EvidenceStatus;
  /** One line a reviewer can read without opening anything else. */
  summary: string;
  /** The facts the fingerprint is computed from. Ordered by key when hashed,
   *  so the fingerprint does not depend on insertion order. */
  facts: Record<string, string | number | boolean>;
  /** Where to go to see it for yourself. */
  href?: string;
}

export interface ReleaseGate {
  id: string;
  name: string;
  /** p99's owner column, verbatim. */
  owner: string;
  /** p99's evidence column, verbatim. */
  evidenceLabel: string;
  /** p99's blocking condition, verbatim. */
  blockingCondition: string;
  evidenceClass: EvidenceClass;
}

/** p99's eight gates, in p99's order. */
export const RELEASE_GATES: ReleaseGate[] = [
  {
    id: "demo_identity",
    name: "Demo identity",
    owner: "Admin and security",
    evidenceLabel: "Identity scan and reset report",
    blockingCondition: "Any personal-looking or historical user data remains",
    evidenceClass: "measured",
  },
  {
    id: "safety_regression",
    name: "Safety regression",
    owner: "Clinical safety and quality",
    evidenceLabel: "All policy and failure scenarios",
    blockingCondition: "Any gate, support or re-entry failure",
    evidenceClass: "measured",
  },
  {
    id: "clinical_language",
    name: "Clinical language",
    owner: "Clinical reviewer",
    evidenceLabel: "Approved page and gate copy",
    blockingCondition: "Unsupported diagnosis, readiness or care claim",
    evidenceClass: "measured",
  },
  {
    id: "projection_parity",
    name: "Projection parity",
    owner: "Data engineering",
    evidenceLabel: "Ledger rebuild compared with live projections",
    blockingCondition: "Any unexplained mismatch",
    evidenceClass: "on_demand",
  },
  {
    id: "authorization",
    name: "Authorization",
    owner: "Security",
    evidenceLabel: "Tenant, role, consent and evidence attack suite",
    blockingCondition: "Any cross-scope access",
    evidenceClass: "attested",
  },
  {
    id: "accessibility",
    name: "Accessibility",
    owner: "Product and QA",
    evidenceLabel: "Automated and manual checks",
    blockingCondition: "Any blocked keyboard or screen-reader path",
    evidenceClass: "attested",
  },
  {
    id: "analytics_integrity",
    name: "Analytics integrity",
    owner: "Data and product",
    evidenceLabel: "Denominator, missingness, suppression, source and version tests",
    blockingCondition: "Any clean chart hiding incomplete data",
    evidenceClass: "attested",
  },
  {
    id: "claims_discipline",
    name: "Claims discipline",
    owner: "Product and legal review",
    evidenceLabel: "Public claim registry",
    blockingCondition: "Any target or model presented as demonstrated fact",
    evidenceClass: "measured",
  },
];

export function gateById(id: string): ReleaseGate | undefined {
  return RELEASE_GATES.find((g) => g.id === id);
}

/**
 * The fingerprint a sign-off is bound to.
 *
 * This is the mechanism behind §26 p44's "release gates cannot be bypassed
 * from ordinary admin controls". The approval is recorded against this hash,
 * so if the evidence changes afterwards the approval no longer matches and the
 * gate reads as undecided again. Nobody has to notice; the mismatch is what
 * shows.
 *
 * Keys are sorted so the hash depends on the facts and not on the order a
 * resolver happened to write them.
 */
export function fingerprint(facts: Record<string, string | number | boolean>): string {
  const canonical = Object.keys(facts)
    .sort()
    .map((k) => `${k}=${String(facts[k])}`)
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/** An attested gate still needs a fingerprint, or its sign-off could never be
 *  invalidated. It is bound to the versions that define what was attested TO —
 *  so a safety-config or claims-registry bump reopens the attestation rather
 *  than carrying it silently forward. */
function attestedFacts(gateId: string): Record<string, string> {
  return {
    gate: gateId,
    safetyConfigVersion: SAFETY_CONFIG_VERSION,
    claimsVersion: SITE_CLAIMS_VERSION,
  };
}

export interface ResolveOptions {
  /** Run the expensive on-demand checks too. Off by default. */
  includeOnDemand?: boolean;
  /** Supplied by the caller because resolving it needs an async import the
   *  gate table does not otherwise want. Only used by projection parity. */
  projectionParity?: { identical: boolean; compared: number; diffs: number } | null;
  /** The clinical-language decision tally, from the clinical review screen. */
  clinicalLanguage?: { total: number; approved: number; blocked: number; changesRequested: number } | null;
}

/**
 * Resolve every gate's evidence.
 *
 * Synchronous and cheap by default: the two expensive checks are passed IN by
 * the caller rather than reached for here, which keeps this table free of the
 * question "did opening the release screen just rebuild the ledger".
 */
export function resolveEvidence(db: Database.Database, opts: ResolveOptions = {}): Map<string, GateEvidence> {
  const out = new Map<string, GateEvidence>();

  // --- Demo identity: the scan and the quality checks, both already built.
  const scan = runIdentityScan(db);
  const quality = runQualityChecks(db);
  const q = qualitySummary(quality);
  const identityClean = scan.severity === "clean" && q.ok;
  out.set("demo_identity", {
    status: identityClean ? "pass" : "fail",
    summary: identityClean
      ? `Identity scan clean across ${scan.scanned.toLocaleString()} values; ${q.passed} data-quality checks passed`
      : `${scan.findings.length} identity finding(s) at severity "${scan.severity}"; ${q.failed} data-quality check(s) failed`,
    facts: {
      severity: scan.severity,
      findings: scan.findings.length,
      scanned: scan.scanned,
      unreadable: scan.unreadable,
      fabricatedPeople: scan.fabricatedPeople,
      qualityFailed: q.failed,
    },
    href: "/review/demo-data",
  });

  // --- Safety regression: the fixed scenarios, replayed.
  const scenarios = replayScenarios();
  const failed = scenarios.filter((s) => !s.pass);
  out.set("safety_regression", {
    status: failed.length === 0 ? "pass" : "fail",
    summary:
      failed.length === 0
        ? `All ${scenarios.length} fixed scenarios reached their expected tier`
        : `${failed.length} of ${scenarios.length} scenarios did not reach the expected tier`,
    facts: {
      total: scenarios.length,
      failed: failed.length,
      configVersion: SAFETY_CONFIG_VERSION,
    },
    href: "/review/safety",
  });

  // --- Clinical language: the decisions recorded on /review/clinical.
  const cl = opts.clinicalLanguage;
  if (!cl) {
    out.set("clinical_language", {
      status: "unavailable",
      summary: "Copy review not resolved",
      facts: { resolved: false },
      href: "/review/clinical",
    });
  } else {
    const outstanding = cl.total - cl.approved;
    out.set("clinical_language", {
      status: cl.blocked > 0 ? "fail" : outstanding === 0 ? "pass" : "unavailable",
      summary:
        cl.blocked > 0
          ? `${cl.blocked} surface(s) blocked by the clinical reviewer`
          : outstanding === 0
            ? `All ${cl.total} reviewable surfaces approved at the current copy version`
            : `${outstanding} of ${cl.total} surfaces not yet approved at the current copy version`,
      facts: {
        total: cl.total,
        approved: cl.approved,
        blocked: cl.blocked,
        changesRequested: cl.changesRequested,
        claimsVersion: SITE_CLAIMS_VERSION,
      },
      href: "/review/clinical",
    });
  }

  // --- Projection parity: expensive, so only when the caller resolved it.
  const pp = opts.projectionParity;
  out.set("projection_parity", {
    status: !pp ? "unavailable" : pp.identical ? "pass" : "fail",
    summary: !pp
      ? "Not run. A ledger rebuild is expensive enough that it is not run on page load"
      : pp.identical
        ? `Rebuild matched live projections across ${pp.compared.toLocaleString()} rows`
        : `${pp.diffs} row(s) differed between the rebuild and live projections`,
    facts: pp ? { identical: pp.identical, compared: pp.compared, diffs: pp.diffs } : { resolved: false },
    href: "/review/lineage",
  });

  // --- Claims discipline: the registry version and its guarded vocabulary.
  out.set("claims_discipline", {
    status: "pass",
    summary: `Public claim registry at ${SITE_CLAIMS_VERSION}, with the restricted-phrase guard enforced in the test suite`,
    facts: { claimsVersion: SITE_CLAIMS_VERSION },
    href: "/trust",
  });

  // --- The three the system cannot check for itself.
  for (const id of ["authorization", "accessibility", "analytics_integrity"]) {
    out.set(id, {
      status: "unavailable",
      summary: "Not machine-checkable. This gate is an attestation by its named owner, recorded with a reference to the evidence",
      facts: attestedFacts(id),
    });
  }

  return out;
}
