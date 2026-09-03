// What the clinical reviewer reviews (§26 p44: "Clinical review —
// /review/clinical — Review language and flow — Version, evidence, decision").
//
// §31.6 names the evidence for this gate as "approved page and gate copy" and
// its blocking condition as "unsupported diagnosis, readiness or care claim".
// So the reviewable unit is a piece of MEMBER-FACING CLINICAL LANGUAGE, and
// the decision has to bind to the exact words.
//
// EVERY SURFACE HERE PULLS ITS TEXT FROM THE MODULE THAT SHIPS IT. None of the
// strings below are typed out in this file. A registry that transcribed the
// copy would drift from the product the first time somebody edited one and not
// the other, and the review screen would then be approving words nobody reads
// — while looking exactly as convincing as one that worked.
//
// The version each surface is reviewed AT is the version of the policy that
// governs its language. When that policy version changes the recorded decision
// stops matching and the surface returns to unreviewed, which is the intended
// behaviour: a copy change is a re-review, not a footnote.

import { GATE_STATES, gateCopyFor } from "../clinical/gate-review";
import { CLINICAL_POLICY_VERSION } from "../clinical-policy";
import { CRISIS_SCRIPT_VERSION } from "../session-safety";
import { CONSENT_VERSION } from "../policy";

/** What kind of claim a surface is allowed to make. The reviewer is checking
 *  the copy against this, and naming it per surface is what turns "does this
 *  read well" into "is this within what we may say". */
export type ClaimClass = "availability" | "safety" | "care_process" | "consent";

export const CLAIM_MEANING: Record<ClaimClass, string> = {
  availability: "States whether something is open to this member today. May not explain why in clinical terms.",
  safety: "States that a safety rule acted. May not diagnose, and may not imply the member did something wrong.",
  care_process: "Describes what happens next in the member's care. May not promise an outcome or a timeline.",
  consent: "Describes what the member is agreeing to. Must be true of what the system actually does.",
};

export interface ReviewableSurface {
  id: string;
  name: string;
  /** Where a member meets this language. */
  appearsAt: string;
  claimClass: ClaimClass;
  /** The shipping words, read from their source module. */
  copy: string;
  /** Supporting lines shown with the copy, where the surface has them. */
  supporting: { label: string; text: string }[];
  /** The policy version this surface's language is governed by. */
  governedBy: string;
  /** The module the copy is read from, so a reviewer can go and look. */
  source: string;
}

/**
 * Every surface a clinical reviewer signs off, built at call time from the
 * shipping modules.
 *
 * Built rather than declared, for the reason at the top of this file: the
 * strings must come from the product.
 */
export function reviewableSurfaces(): ReviewableSurface[] {
  const surfaces: ReviewableSurface[] = [];

  // The six gate states. These are the highest-stakes clinical language in the
  // product: they are what a member reads at the moment they are told they
  // cannot do something.
  for (const state of GATE_STATES) {
    const copy = gateCopyFor(state);
    surfaces.push({
      id: `gate.${state}`,
      name: `Gate — ${copy.headline}`,
      appearsAt: "Member banner and clinician drawer",
      claimClass: state === "safety_stop" ? "safety" : state === "review_needed" ? "care_process" : "availability",
      copy: copy.member,
      supporting: [
        { label: "Headline", text: copy.headline },
        { label: "Primary action", text: copy.action },
        ...(copy.alternative ? [{ label: "Always-open alternative", text: copy.alternative }] : []),
      ],
      governedBy: CLINICAL_POLICY_VERSION,
      source: "src/lib/clinical/gate-review.ts",
    });
  }

  return surfaces;
}

/**
 * The composite version a clinical-language decision is recorded against.
 *
 * Composite because the language is governed by more than one policy, and a
 * decision that only tracked one of them would survive a change to the others.
 * Any bump reopens every clinical-language review — which is heavier than
 * per-surface versioning and is the right trade: these are the sentences a
 * member reads when they are told no.
 */
export function copyVersion(): string {
  return [CLINICAL_POLICY_VERSION, CRISIS_SCRIPT_VERSION, CONSENT_VERSION].join("+");
}
