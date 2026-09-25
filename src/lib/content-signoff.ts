// Content sign-off — whether a piece of new member content may be seen
// (Handoff 10 §0.2, §3.3).
//
//   "Unsigned content does not ship. Every new content item carries a
//    signoffRowId. isContentLive() returns false unless that row is approved
//    in autonomous_signoffs. In demo mode drafts may render with a 'Pending
//    clinical review' chip; in any other environment they are absent from
//    every list, route, API response, and companion selection. Fail closed."
//
// SAME STORAGE, SAME FLOW as the safety rules and the knowledge-base rows: a
// clinician's Agree / Needs-change verdict in autonomous_signoffs, scoped to
// the config version. "Approved" here means the latest verdict is `agree`.
//
// THE ROWS ARE THE WORKSHEET'S, in its words: ids are its row numbers
// (CV10_A01 …) and each reason is its "Item" and "Decision asked" columns, so a
// verdict on the signed form maps one to one (docs/approvals/
// handoff-10-content-SIGNED-2026-09-24.pdf; the record of what was signed is
// src/lib/content-approval.ts).
//
// FAIL CLOSED, in three ways: an item naming a row that is not in this list is
// not live; a row with no approval is not live; a row whose latest verdict is
// needs-change is not live. Only items with NO row — the content that existed
// before this handoff — are live without one.

import type { CatalogRule } from "./safety/rule-catalog";
import type { RuleSignoff } from "./safety/signoff";
import { approvedContentRows } from "./content-approval";

// One departure from the form's words: A01 on the form names the config
// version in parentheses after "ratified on 2026-07-22". It is left out here
// because that version has exactly one definition (safety/governance.ts), and
// the date identifies the ratification without a second copy of it.
export const CONTENT_V10_RULES: CatalogRule[] = [
  { id: "CV10_A01", category: "content_v10", reason: "P0: Butterfly hug removal. The KB entry somatic-butterfly-hug told the companion to offer slow alternating taps: self-administered BLS, available to highly activated members. It was replaced with a static self-hold (steady pressure, no tapping, no alternation) and the original removed. Confirm the rewrite, or require removal of the self-hold too. This changes the therapy-KB configuration ratified on 2026-07-22; this verdict is that renewed review for this entry." },
  { id: "CV10_A02", category: "content_v10", reason: "Skills library selection and gating: 18 KB techniques become member-facing skills with the tiers and activation ceilings listed. Confirm the selection and each tier and ceiling." },
  { id: "CV10_A03", category: "content_v10", reason: "Skill wording (S01 to S18): member-facing titles, intros, when-to-use, and steps for all 18 skills." },
  { id: "CV10_A04", category: "content_v10", reason: "Cold water skill stays out of member library: dbt-temperature (cold water) is excluded from the member library because temperature-shock skills can act as a pain substitute where self-harm history is common. Confirm, and say whether the companion should keep offering it at all." },
  { id: "CV10_A05", category: "content_v10", reason: "'Skip if' notes shown to members: member-visible notes (e.g. heart condition for Move it out). They are shown but not mechanically enforced. Confirm that is acceptable." },
  { id: "CV10_A06", category: "content_v10", reason: "Lesson L1: When your body stays on alert. Text as written." },
  { id: "CV10_A07", category: "content_v10", reason: "Lesson L2: Shame and the harsh inner voice. Text as written." },
  { id: "CV10_A08", category: "content_v10", reason: "Lesson L3: Anger makes sense. Text as written, including the SOS line." },
  { id: "CV10_A09", category: "content_v10", reason: "Lesson L4: Feeling far away. Text as written, including the suggestion to mention frequent episodes to a doctor." },
  { id: "CV10_A10", category: "content_v10", reason: "Lesson L5: Stress and sleep. Text as written, including the snoring and drowsy-driving line." },
  { id: "CV10_A11", category: "content_v10", reason: "Lesson L6: Trust and closeness. Text as written." },
  { id: "CV10_A12", category: "content_v10", reason: "Lesson L7: Coping that costs more later. Text as written." },
  { id: "CV10_A13", category: "content_v10", reason: "Lesson L8: Action before motivation. Text as written." },
  { id: "CV10_A14", category: "content_v10", reason: "New practices: After a bad dream, Back to rest. Scripts, timings, and gating (After a bad dream: grounding tier, ceiling 10; Back to rest: stabilization tier, ceiling 7)." },
  { id: "CV10_A15", category: "content_v10", reason: "Crisis pre-filter on all new free text: every new free-text field runs the existing crisis regex before saving. A match triggers the scripted crisis interrupt and saves nothing. Confirm this coverage is sufficient." },
  { id: "CV10_A16", category: "content_v10", reason: "Companion is read-only for programs: the companion may suggest a skill or practice through a gated tool but cannot enroll, complete, or write program data, and never reads member-written entries." },
  { id: "CV10_A17", category: "content_v10", reason: "Audio and soundscape limits: no stereo panning, binaural or isochronic tones, or rhythmic audio. Mono or identical channels. Confirm these limits keep listening content clear of BLS." },
  { id: "CV10_B01", category: "content_v10", reason: "Moving Toward program: four units, activity menu, and all copy." },
  { id: "CV10_B02", category: "content_v10", reason: "Moving Toward gating: KB default puts activation work at the top tier with ceiling 4. Proposed: units 1 and 2 at stabilization tier, ceiling 6; units 3 and 4 at cautious tier, ceiling 6; Gentle menu items only at stabilization tier. Choose proposal, KB default, or your own values." },
  { id: "CV10_B03", category: "content_v10", reason: "Reflection data: optional 0 to 10 mastery and enjoyment ratings are stored but never shown to the member outside the Progress screen. 'Not this time' offers to shrink the step and never asks why." },
  { id: "CV10_B04", category: "content_v10", reason: "Care path changes: add Moving Toward to Low Mood and Anxiety paths. Consider updating the Low Mood evidence note to reflect behavioral activation's evidence base." },
  { id: "CV10_B05", category: "content_v10", reason: "PHQ-9 item 9 routing: existing item 9 routing is unchanged by this program. Confirm it is adequate for members enrolled in Moving Toward." },
  { id: "CV10_C01", category: "content_v10", reason: "Steadier Sleep program: four units and all copy." },
  { id: "CV10_C02", category: "content_v10", reason: "Self-guided stimulus control: instructions as written, including getting up after roughly 20 minutes awake and a fixed getting-up time." },
  { id: "CV10_C03", category: "content_v10", reason: "Exclusion of sleep restriction: sleep restriction and compression are excluded from self-guided use. The app never suggests a time-in-bed limit." },
  { id: "CV10_C04", category: "content_v10", reason: "Sleep entry screen: three yes/no items. Any yes withholds Unit 2 only and suggests talking with a doctor. Confirm items, wording, and what is withheld." },
  { id: "CV10_C05", category: "content_v10", reason: "Sleep measure: candidate PROMIS Sleep Disturbance 8a, subject to licensing (F01). Confirm or propose another." },
  { id: "CV10_D01", category: "content_v10", reason: "Feeling and Relating, structure and naming: eight-unit skills program informed by the STAIR skills phase. Original content, not a STAIR implementation, never named as one to members." },
  { id: "CV10_D02", category: "content_v10", reason: "Feeling and Relating, gating: units 1 to 4 stabilization tier, ceiling 6; units 5 to 8 cautious tier, ceiling 5; no imagery. Available on the trauma path and on the complex readiness path only when that path's clinician review is satisfied." },
  { id: "CV10_D03", category: "content_v10", reason: "Feeling and Relating, unit copy: all prompts are about current relationships only, with an explicit line steering away from past events." },
  { id: "CV10_D04", category: "content_v10", reason: "Member thought records: fields, cautious tier with ceiling 6, grounding prompt when feeling is 8 or higher, entries private to the member." },
  { id: "CV10_D05", category: "content_v10", reason: "Riding Strong Feelings: four units built from live skills, plus the option to add skills to the SOS plan." },
  { id: "CV10_E01", category: "content_v10", reason: "Lane rules: never self-startable; active assignment required; assignments expire; distress 0 to 10 before and after; grounding, SOS, and clinician flag if after exceeds before by 3 or more, or exceeds 7." },
  { id: "CV10_E02", category: "content_v10", reason: "Written exposure container: narrative stored encrypted, visible to member and assigning clinician only, fully excluded from the companion. Retention per partner policy." },
  { id: "CV10_E03", category: "content_v10", reason: "CPT worksheet container: worksheets supplied by the partner under license; same lane rules." },
  { id: "CV10_E04", category: "content_v10", reason: "Imagery rehearsal container (nightmares): supplied by the partner; same lane rules and narrative handling as E02." },
  { id: "CV10_E05", category: "content_v10", reason: "Protocol source and fidelity: who supplies each protocol, under what license, and who is responsible for fidelity. No protocol content is written by Steady." },
  { id: "CV10_F01", category: "content_v10", reason: "Sleep measure licensing: confirm the terms for using the chosen sleep measure inside a commercial product." },
  { id: "CV10_F02", category: "content_v10", reason: "Names in member copy: approve program names. Confirm modality names (DBT, ACT, STAIR, CBT-I) stay out of member copy." },
  { id: "CV10_F03", category: "content_v10", reason: "CI vocabulary coverage: extend the banned-vocabulary check to content files in src/lib, and add the modality-name check." },
  { id: "CV10_F04", category: "content_v10", reason: "Audio rights: written rights for narrator recordings and soundscapes." },
  { id: "CV10_F05", category: "content_v10", reason: "Regulatory framing: confirm the new content keeps Steady within its general-wellness positioning." },
];

const ROW_IDS = new Set(CONTENT_V10_RULES.map((r) => r.id));

export function isContentRow(id: string): boolean {
  return ROW_IDS.has(id);
}

/** Demo is the one environment where a draft may be seen, and only marked. */
export function draftsVisible(): boolean {
  return process.env.EMDR_DEMO === "1";
}

export type ContentVisibility =
  /** Signed, or content that predates sign-off. Shown everywhere. */
  | "live"
  /** Unsigned, in demo: shown with a "Pending clinical review" chip. */
  | "draft"
  /** Unsigned, anywhere else: absent from every list, route, API and companion. */
  | "absent";

/** The rows an item needs. Handoff 10 names one `signoffRowId`; a skill
 *  rides on three (selection and gating, wording, skip-if notes), so an item
 *  lists every row it needs and is live only when all are. */
export interface SignedItem {
  signoffRowIds?: readonly string[];
}

/** Pure. A row's standing: the latest verdict in the sign-off table if there
 *  is one — so a clinician can still send a row back — otherwise the signed
 *  record (content-approval.ts). */
export function rowApproved(
  rowId: string,
  signoffs: ReadonlyMap<string, Pick<RuleSignoff, "verdict">>
): boolean {
  if (!isContentRow(rowId)) return false;
  const verdict = signoffs.get(rowId)?.verdict;
  if (verdict !== undefined) return verdict === "agree";
  return approvedContentRows().has(rowId);
}

export function isContentLive(item: SignedItem, signoffs: ReadonlyMap<string, Pick<RuleSignoff, "verdict">>): boolean {
  const ids = item.signoffRowIds;
  if (ids === undefined) return true;
  // An empty list is a mistake, not "needs nothing": it fails closed.
  if (ids.length === 0) return false;
  return ids.every((id) => rowApproved(id, signoffs));
}

export function contentVisibility(
  item: SignedItem,
  signoffs: ReadonlyMap<string, Pick<RuleSignoff, "verdict">>,
  demo: boolean = draftsVisible()
): ContentVisibility {
  if (isContentLive(item, signoffs)) return "live";
  // A draft is only ever a draft of KNOWN rows: an item naming a row that does
  // not exist is a mistake, not something to preview.
  const ids = item.signoffRowIds ?? [];
  if (demo && ids.length > 0 && ids.every(isContentRow)) return "draft";
  return "absent";
}

/** Keep what may be seen here, in order. The one filter every list, route,
 *  API and companion selection uses. */
export function visibleContent<T extends SignedItem>(
  items: readonly T[],
  signoffs: ReadonlyMap<string, Pick<RuleSignoff, "verdict">>,
  demo: boolean = draftsVisible()
): Array<T & { visibility: Exclude<ContentVisibility, "absent"> }> {
  const out: Array<T & { visibility: Exclude<ContentVisibility, "absent"> }> = [];
  for (const item of items) {
    const v = contentVisibility(item, signoffs, demo);
    if (v !== "absent") out.push({ ...item, visibility: v });
  }
  return out;
}

export const PENDING_REVIEW_CHIP = "Pending clinical review";
