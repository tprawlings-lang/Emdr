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
// THE ROWS ARE THE WORKSHEET'S. Their ids are the Handoff 10 worksheet row
// numbers (CV10_A01 …), so a signed worksheet can be entered one to one. The
// worksheet itself (10-clinician-signoff.docx) has not arrived, so only the
// rows whose subject the handoff states are here, in the handoff's words. The
// rest are added from the worksheet when it arrives — never guessed, because a
// row's text is what a clinician signs.
//
// FAIL CLOSED, in three ways: an item naming a row that is not in this list is
// not live; a row with no verdict is not live; a row whose latest verdict is
// needs-change is not live. Only items with NO signoffRowId — the content that
// existed before this handoff — are live without one.

import type { CatalogRule } from "./safety/rule-catalog";
import type { RuleSignoff } from "./safety/signoff";

export const CONTENT_V10_RULES: CatalogRule[] = [
  {
    id: "CV10_A04",
    category: "content_v10",
    reason:
      "Cold-water (temperature) skills stay out of the member skills library and remain companion-only: a temperature shock can work as a stand-in for pain in a population where self-harm history is common.",
  },
  {
    id: "CV10_B02",
    category: "content_v10",
    reason:
      "Gating for the behavioral activation program. The knowledge base places it at the steady tier with an activation ceiling of 4, which keeps it from most people with low mood. Proposed: units 1 and 2 at the stabilization tier, ceiling 6; units 3 and 4 at the cautious tier, ceiling 6; at stabilization the activity menu shows only its gentle category. Until this is signed, the knowledge-base values apply.",
  },
  {
    id: "CV10_B04",
    category: "content_v10",
    reason:
      "An updated evidence note for the depression care path, now that it is supported by the behavioral activation program. The evidence grade does not change in the product until this is signed.",
  },
  {
    id: "CV10_C03",
    category: "content_v10",
    reason:
      "Sleep restriction and sleep compression are left out of the sleep program: they reduce time in bed and are not appropriate self-guided for this population.",
  },
  {
    id: "CV10_C04",
    category: "content_v10",
    reason:
      "The sleep program's three entry questions (a period of very little sleep with a lot of energy that others noticed; stopping breathing, gasping or loud snoring, or nodding off while driving; a seizure condition or a health reason not to get out of bed at night). Any yes withholds the unit on the bed and sleep window, with 'Some of this program is worth talking over with a doctor first'; the rest stays available. Only a coded event is recorded.",
  },
  {
    id: "CV10_D04",
    category: "content_v10",
    reason:
      "Member thought records: something from the last few days, the feeling and its strength, the thought, what supports it and what does not, a more balanced thought, the strength now. Cautious tier, ceiling 6. Entries are the member's only — not shown to clinicians, not given to the companion.",
  },
  {
    id: "CV10_D05",
    category: "content_v10",
    reason:
      "The Riding Strong Feelings program: stop before reacting, soothe and wait, ride the urge, make room — built mostly from live skills, gated by those skills.",
  },
  {
    id: "CV10_E01",
    category: "content_v10",
    reason:
      "Clinician-assigned lane rules: listed only with an active assignment; assignments expire; distress 0–10 before and after every run, with grounding, SOS and a flag to the assigning clinician if after is 3 or more above before, or above 7; stopping is always available and never penalised. Parked until the Handoff 03 gate, a provider partner and licensed content are in place.",
  },
  {
    id: "CV10_E02",
    category: "content_v10",
    reason: "Written exposure, clinician-assigned only. Container only — no protocol content until licensed content is supplied by a partner.",
  },
  {
    id: "CV10_E03",
    category: "content_v10",
    reason: "Cognitive processing worksheets, clinician-assigned only. Container only — no protocol content until licensed content is supplied by a partner.",
  },
  {
    id: "CV10_E04",
    category: "content_v10",
    reason: "Imagery rehearsal for nightmares, clinician-assigned only. Container only — no protocol content until licensed content is supplied by a partner.",
  },
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

/** Pure. `signoffs` is the latest verdict per row for the current config
 *  version (safety/signoff.ts, getRuleSignoffs). */
export function isContentLive(
  item: { signoffRowId?: string },
  signoffs: ReadonlyMap<string, Pick<RuleSignoff, "verdict">>
): boolean {
  if (item.signoffRowId === undefined) return true;
  if (!isContentRow(item.signoffRowId)) return false;
  return signoffs.get(item.signoffRowId)?.verdict === "agree";
}

export function contentVisibility(
  item: { signoffRowId?: string },
  signoffs: ReadonlyMap<string, Pick<RuleSignoff, "verdict">>,
  demo: boolean = draftsVisible()
): ContentVisibility {
  if (isContentLive(item, signoffs)) return "live";
  // A draft is only ever a draft of a KNOWN row: an item naming a row that does
  // not exist is a mistake, not something to preview.
  if (demo && item.signoffRowId !== undefined && isContentRow(item.signoffRowId)) return "draft";
  return "absent";
}

/** Keep what may be seen here, in order. The one filter every list, route,
 *  API and companion selection uses. */
export function visibleContent<T extends { signoffRowId?: string }>(
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
