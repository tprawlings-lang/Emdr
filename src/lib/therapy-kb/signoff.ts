// Therapy knowledge base — sign-off rows. One row per modality plus the
// global constraints, in the same {id, category, reason} shape and the same
// autonomous_signoffs storage as every other clinician-reviewed rule.

import type { CatalogRule } from "../safety/rule-catalog";
import { MODALITIES, TECHNIQUES } from "./catalog";

const GLOBAL_RULES: CatalogRule[] = [
  {
    id: "KB_ADVISORY_ONLY",
    category: "therapy_kb",
    reason:
      "Catalog entries are advisory vocabulary for the companion — never treatment, reprocessing, or exposure work. Actual EMDR happens only in the guided session modules.",
  },
  {
    id: "KB_TIER_GATED",
    category: "therapy_kb",
    reason:
      "Every entry declares a minimum access tier and an activation ceiling; the deterministic selector filters by the member's current tier, distress, and dissociation (most restrictive wins). Crisis tier receives no KB content — the crisis flow stays fully scripted.",
  },
  {
    id: "KB_OUTPUT_GUARDED",
    category: "therapy_kb",
    reason:
      "KB influence changes nothing about enforcement: every companion reply still passes the deterministic output guard (validateCompanionOutput), and violations are replaced with the safe fallback when governance is on.",
  },
  {
    id: "KB_RESTRICTED_TOPICS",
    category: "therapy_kb",
    reason:
      "Entries that touch a member's restricted topics are dropped from selection for that member before scoring.",
  },
  {
    id: "KB_DETERMINISTIC_RETRIEVAL",
    category: "therapy_kb",
    reason:
      "Retrieval is deterministic keyword/state scoring in reviewable code — same inputs, same selection — with no embeddings or network calls, so every selection is reproducible and auditable.",
  },
  {
    id: "KB_AVOIDWHEN_ADVISORY",
    category: "therapy_kb",
    reason:
      "HONESTY ROW (audit): the enforced gates are minTier, maxActivation, dissociation→grounding-only, imagery capability, and restricted topics. The per-entry 'avoid when' notes are NOT mechanically enforced — they are visible to the model inside the guidance and reviewed by you here. Sign off knowing that distinction, or mark needs-change to demand mechanical enforcement.",
  },
  {
    id: "KB_UNKNOWN_STATE_CONSERVATIVE",
    category: "therapy_kb",
    reason:
      "Missing data is a stop signal: unknown activation is treated as high, unknown dissociation restricts to grounding-class entries and blocks imagery, and if the access engine cannot be evaluated the companion gets no KB content at all for that reply.",
  },
];

/** One sign-off row per modality (verdict covers its techniques as a set). */
const MODALITY_RULES: CatalogRule[] = MODALITIES.map((m) => {
  const techs = TECHNIQUES.filter((t) => t.modality === m.id);
  return {
    id: `KB_MODALITY_${m.id.toUpperCase()}`,
    category: "therapy_kb_modality",
    reason: `${m.name} — ${m.rationale} Techniques: ${techs.map((t) => t.name).join("; ") || "(none yet)"}.`,
  };
});

export const THERAPY_KB_RULES: CatalogRule[] = [...GLOBAL_RULES, ...MODALITY_RULES];
