import { newId } from "./db";
import { data } from "./data";
import { MODULES } from "./modules";

// Care pathways ("tracks"): a goal-based routing layer over the shared,
// bounded EMDR-method modules. A member tells us in their own words what they
// want to work on; we route them to one or more pathways. Each pathway is a
// *sequence and framing* over existing modules — never new self-run
// reprocessing content — and carries an honest evidence grade, contraindication
// tags, allowed-claim limits, and a clinician-review level.
//
// This is the handoff's §14 module-card template adapted to the self-guided
// wellness lane:
//   - Pathways never loosen a safety gate. Module access is still governed by
//     gating.ts (screener, check-in, readiness, prerequisites, unlocks).
//   - `clinicianReview: "required"` pathways are referral/stabilization lanes:
//     they offer grounding and preparation only and route the member to a
//     specialist for the deeper work. They never unlock self-run processing.
//   - Evidence grades are shown to members honestly; copy stays structure/
//     function ("an approach used for…"), never an outcome or cure claim.
//
// This is distinct from the readiness *track* in profile.ts: readiness says
// how deep a member can safely go today; a care pathway says what they are
// working on. Both apply at once.

export type EvidenceGrade = "high" | "moderate" | "emerging" | "specialist";

export type ClinicianReview = "optional" | "recommended" | "required";

export interface CareTrack {
  id: string;
  name: string;
  /** One-line, member-facing summary. Structure/function language only. */
  blurb: string;
  /** What this pathway is for, in plain language. */
  scope: string;
  evidenceGrade: EvidenceGrade;
  /** Honest, member-facing note on the strength of the evidence. */
  evidenceNote: string;
  clinicianReview: ClinicianReview;
  /** Ordered module ids this pathway draws on (all exist in modules.ts). */
  moduleIds: string[];
  /**
   * Contraindication tags. These are advisory metadata surfaced to the member
   * and care team — the binding safety gates remain in gating.ts.
   */
  contraindications: string[];
  /** When clinicianReview is "required", why, and where to point the member. */
  referralNote?: string;
}

export const EVIDENCE_LABELS: Record<EvidenceGrade, string> = {
  high: "Strong evidence",
  moderate: "Moderate evidence",
  emerging: "Emerging evidence",
  specialist: "Specialist-supported",
};

// Pathways. Ordered roughly by how broadly self-guided they are: the
// strongest-evidence, fully self-guided lanes first; specialist/referral
// lanes last.
export const TRACKS: CareTrack[] = [
  {
    id: "ptsd_trauma",
    name: "PTSD & Trauma",
    blurb: "For trauma-linked distress — intrusive memories, nightmares, avoidance, hypervigilance.",
    scope:
      "An approach used for trauma-linked patterns: intrusive memories, nightmares, avoidance, feeling constantly on guard, and the beliefs that travel with them.",
    evidenceGrade: "high",
    evidenceNote:
      "The EMDR method has strong guideline support for PTSD (VA/DoD, NICE, WHO). This is our most established pathway.",
    clinicianReview: "recommended",
    moduleIds: [
      "calm-place",
      "containment",
      "body-scan",
      "trigger-map",
      "resourcing",
      "recent-trigger",
      "safe-target",
      "installation",
      "future-template",
      "maintenance",
    ],
    contraindications: ["active_crisis", "high_dissociation", "current_danger"],
  },
  {
    id: "anxiety_panic",
    name: "Anxiety & Panic",
    blurb: "For panic, body alarm, and worry that keeps the nervous system on edge.",
    scope:
      "An approach used for panic, body alarm, social fears, and non-specific worry — including anxiety linked to past experiences.",
    evidenceGrade: "moderate",
    evidenceNote:
      "Meta-analyses suggest the method can reduce anxiety symptoms; the evidence base is smaller than for PTSD.",
    clinicianReview: "recommended",
    moduleIds: [
      "calm-place",
      "containment",
      "body-scan",
      "resourcing",
      "trigger-map",
      "recent-trigger",
      "future-template",
      "maintenance",
    ],
    contraindications: ["active_crisis", "panic_without_stabilization"],
  },
  {
    id: "phobia_fear",
    name: "Phobias & Specific Fears",
    blurb: "For a specific feared object or situation — flying, driving, needles, animals.",
    scope:
      "An approach used for a specific, contained fear — a feared object or situation such as flying, driving, dental care, needles, or heights.",
    evidenceGrade: "moderate",
    evidenceNote:
      "Single-case and small studies support the method for specific phobias; a clinician may also discuss exposure-based alternatives.",
    clinicianReview: "recommended",
    moduleIds: [
      "calm-place",
      "containment",
      "resourcing",
      "trigger-map",
      "recent-trigger",
      "future-template",
      "maintenance",
    ],
    contraindications: ["active_crisis", "fear_masking_trauma"],
  },
  {
    id: "recent_event",
    name: "Recent Event & Acute Stress",
    blurb: "For a distressing event that happened recently — once the danger has passed.",
    scope:
      "An approach used after a recent distressing event, when the danger is over and you want to keep it from settling in.",
    evidenceGrade: "moderate",
    evidenceNote:
      "Recent-event protocols are supported in the EMDR literature; timing and an ongoing-danger check matter, so a specialist review is recommended.",
    clinicianReview: "recommended",
    moduleIds: [
      "calm-place",
      "containment",
      "body-scan",
      "resourcing",
      "recent-trigger",
      "future-template",
    ],
    contraindications: ["ongoing_danger", "active_crisis"],
    referralNote:
      "If the event is still unfolding or you are not yet safe, this pathway pauses — the crisis page has support that helps right now.",
  },
  {
    id: "grief_loss",
    name: "Grief & Loss",
    blurb: "For loss that feels stuck — distressing images, guilt, or avoidance of reminders.",
    scope:
      "Gentle support for loss that feels stuck — distressing images, guilt, anger, or avoiding reminders. Ordinary grief does not need processing; this pathway is for grief that stays sharp.",
    evidenceGrade: "emerging",
    evidenceNote:
      "Grief models and case literature exist with small studies. We distinguish ordinary grief, which this is not for, from stuck or traumatic grief.",
    clinicianReview: "recommended",
    moduleIds: [
      "calm-place",
      "containment",
      "resourcing",
      "relational",
      "trigger-map",
      "future-template",
      "maintenance",
    ],
    contraindications: ["active_crisis", "ordinary_grief"],
  },
  {
    id: "performance_future",
    name: "Confidence & Performance",
    blurb: "For a specific upcoming situation — an interview, a talk, a performance.",
    scope:
      "A non-trauma pathway for building confidence ahead of a specific situation — an interview, a presentation, a performance — by rehearsing yourself coping.",
    evidenceGrade: "emerging",
    evidenceNote:
      "Future-template and performance work appear in EMDR references for non-trauma goals when risk is low.",
    clinicianReview: "optional",
    moduleIds: ["calm-place", "resourcing", "future-template", "maintenance"],
    contraindications: ["performance_masking_trauma"],
    referralNote:
      "If the nerves are really about an unresolved past experience, a trauma-focused pathway fits better — your check-in helps tell.",
  },
  {
    id: "depression_adjunct",
    name: "Low Mood (Adjunct)",
    blurb: "For heaviness and low mood linked to past experiences — alongside other care.",
    scope:
      "An adjunct pathway for low mood and heaviness that connects to specific memories, shame, or loss. It works best alongside, not instead of, other care you may have.",
    evidenceGrade: "emerging",
    evidenceNote:
      "Evidence for the method in depression is mixed and strongest when low mood is memory-linked; we treat this as an adjunct, not a stand-alone path.",
    clinicianReview: "recommended",
    moduleIds: ["calm-place", "containment", "resourcing", "relational", "trigger-map", "maintenance"],
    contraindications: ["active_crisis", "severe_depression_without_care"],
    referralNote:
      "If low mood is heavy or persistent, please keep a prescriber or counselor in the loop — this pathway is a companion to that care.",
  },
  {
    id: "complex_readiness",
    name: "Complex Trauma — Readiness Lane",
    blurb: "Stabilization and preparation only — deeper work happens with a specialist.",
    scope:
      "A grounding-and-preparation lane for complex trauma and dissociation — losing time, feeling unreal, parts that disagree. It builds stability; the deeper processing happens with a trained specialist, not self-guided.",
    evidenceGrade: "specialist",
    evidenceNote:
      "High dissociation raises risk. The literature supports careful preparation and modified, specialist-led work — so this lane is stabilization only.",
    clinicianReview: "required",
    moduleIds: ["calm-place", "containment", "body-scan", "resourcing"],
    contraindications: ["high_dissociation", "active_crisis", "instability"],
    referralNote:
      "This pathway intentionally does not open self-guided processing. It keeps grounding and preparation available and helps you connect with a specialist for the rest.",
  },
  {
    id: "addiction_adjunct",
    name: "Cravings & Triggers (Adjunct)",
    blurb: "Understanding cravings and triggers — alongside dedicated substance-use care.",
    scope:
      "An adjunct lane for the triggers, cue reactivity, and shame cycles around cravings. It supports grounding and trigger awareness alongside dedicated substance-use care.",
    evidenceGrade: "specialist",
    evidenceNote:
      "Research suggests the method may reduce cravings as an adjunct, but substance-use care must stay primary — so this lane does not open self-guided processing.",
    clinicianReview: "required",
    moduleIds: ["calm-place", "containment", "resourcing", "trigger-map"],
    contraindications: ["withdrawal_risk", "intoxication", "no_sud_care"],
    referralNote:
      "Please keep your substance-use program or provider in the loop. This lane supports grounding and trigger awareness, not reprocessing on your own.",
  },
  {
    id: "pain_somatic",
    name: "Pain & Somatic (Adjunct)",
    blurb: "Grounding for pain that flares with stress — after a medical evaluation.",
    scope:
      "An adjunct lane for chronic pain and body memories that flare with stress, used after a medical evaluation. It supports grounding and body awareness alongside medical care.",
    evidenceGrade: "specialist",
    evidenceNote:
      "Small trials suggest possible benefit, with varied study designs. A medical rule-out comes first, so this lane is grounding and preparation only.",
    clinicianReview: "required",
    moduleIds: ["calm-place", "containment", "body-scan", "resourcing"],
    contraindications: ["no_medical_evaluation", "active_crisis"],
    referralNote:
      "Please have a clinician evaluate the pain first. This lane supports grounding and body awareness alongside that medical care.",
  },
];

export function getTrack(id: string): CareTrack | undefined {
  return TRACKS.find((t) => t.id === id);
}

/** Pathways that open self-guided processing vs. stabilization-only referral lanes. */
export function isReferralOnly(track: CareTrack): boolean {
  return track.clinicianReview === "required";
}

/** Module ids a pathway actually opens for self-guided work. Referral lanes
 * are limited to their stabilization modules regardless of what they list. */
export function selfGuidedModuleIds(track: CareTrack): string[] {
  if (!isReferralOnly(track)) return track.moduleIds;
  const STABILIZATION = new Set(["calm-place", "containment", "body-scan", "resourcing", "trigger-map"]);
  return track.moduleIds.filter((id) => STABILIZATION.has(id));
}

/** The first module of a pathway the member has not yet completed. */
export function nextModuleId(track: CareTrack, completed: Set<string>): string | null {
  const order = new Map(MODULES.map((m) => [m.id, m.order]));
  const ids = [...selfGuidedModuleIds(track)].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99)
  );
  return ids.find((id) => !completed.has(id)) ?? null;
}

// ---------- Member pathway selections (a member may hold more than one) ----------

export interface CareTrackRow {
  id: string;
  user_id: string;
  track_id: string;
  status: "active" | "archived";
  created_at: string;
}

export async function getMemberTracks(userId: string): Promise<CareTrack[]> {
  const c = await data();
  const rows = (await c.all(
    "SELECT track_id FROM care_tracks WHERE user_id = ? AND status = 'active' ORDER BY created_at",
    [userId]
  )) as { track_id: string }[];
  return rows.map((r) => getTrack(r.track_id)).filter((t): t is CareTrack => Boolean(t));
}

export async function hasMemberTrack(userId: string, trackId: string): Promise<boolean> {
  const c = await data();
  const row = await c.get(
    "SELECT 1 FROM care_tracks WHERE user_id = ? AND track_id = ? AND status = 'active' LIMIT 1",
    [userId, trackId]
  );
  return Boolean(row);
}

export async function addMemberTrack(userId: string, trackId: string): Promise<void> {
  if (!getTrack(trackId)) return;
  const c = await data();
  const existing = (await c.get("SELECT id FROM care_tracks WHERE user_id = ? AND track_id = ?", [
    userId,
    trackId,
  ])) as { id: string } | undefined;
  if (existing) {
    await c.run("UPDATE care_tracks SET status = 'active' WHERE id = ?", [existing.id]);
  } else {
    await c.run("INSERT INTO care_tracks (id, user_id, track_id, status) VALUES (?, ?, ?, 'active')", [
      newId(),
      userId,
      trackId,
    ]);
  }
}

export async function archiveMemberTrack(userId: string, trackId: string): Promise<void> {
  const c = await data();
  await c.run("UPDATE care_tracks SET status = 'archived' WHERE user_id = ? AND track_id = ?", [
    userId,
    trackId,
  ]);
}

// ---------- Goal intake (the member's own words + quick tags) ----------

export interface TrackIntake {
  goalText: string | null;
  tags: string[];
}

export async function getTrackIntake(userId: string): Promise<TrackIntake | null> {
  const c = await data();
  const row = (await c.get("SELECT goal_text, tags_json FROM care_track_intake WHERE user_id = ?", [
    userId,
  ])) as { goal_text: string | null; tags_json: string } | undefined;
  if (!row) return null;
  let tags: string[] = [];
  try {
    const v = JSON.parse(row.tags_json);
    if (Array.isArray(v)) tags = v.map(String);
  } catch {
    /* ignore */
  }
  return { goalText: row.goal_text, tags };
}

export async function saveTrackIntake(userId: string, goalText: string | null, tags: string[]): Promise<void> {
  const c = await data();
  const clean = goalText?.trim() ? goalText.trim().slice(0, 1000) : null;
  const tagsJson = JSON.stringify(tags.slice(0, 20));
  const existing = await c.get("SELECT user_id FROM care_track_intake WHERE user_id = ?", [userId]);
  if (existing) {
    await c.run(
      "UPDATE care_track_intake SET goal_text = ?, tags_json = ?, updated_at = datetime('now') WHERE user_id = ?",
      [clean, tagsJson, userId]
    );
  } else {
    await c.run("INSERT INTO care_track_intake (user_id, goal_text, tags_json) VALUES (?, ?, ?)", [
      userId,
      clean,
      tagsJson,
    ]);
  }
}

// Quick-tag intake vocabulary. Each tag points at the pathways it suggests,
// with a weight. Deterministic and transparent — the recommender simply sums
// the weights. Member-facing labels stay plain and non-clinical.
export interface IntakeOption {
  id: string;
  label: string;
  weights: { trackId: string; weight: number }[];
}

export const INTAKE_OPTIONS: IntakeOption[] = [
  {
    id: "intrusions",
    label: "Nightmares, flashbacks, or intrusive memories",
    weights: [
      { trackId: "ptsd_trauma", weight: 3 },
      { trackId: "recent_event", weight: 1 },
    ],
  },
  {
    id: "panic",
    label: "Panic, racing heart, or body alarm",
    weights: [
      { trackId: "anxiety_panic", weight: 3 },
      { trackId: "ptsd_trauma", weight: 1 },
    ],
  },
  {
    id: "specific_fear",
    label: "A specific fear — flying, driving, needles, animals",
    weights: [{ trackId: "phobia_fear", weight: 3 }],
  },
  {
    id: "worry",
    label: "Constant worry or feeling on edge",
    weights: [{ trackId: "anxiety_panic", weight: 3 }],
  },
  {
    id: "grief",
    label: "A loss I can't seem to move past",
    weights: [{ trackId: "grief_loss", weight: 3 }],
  },
  {
    id: "low_mood",
    label: "Low mood, heaviness, or hopelessness",
    weights: [{ trackId: "depression_adjunct", weight: 3 }],
  },
  {
    id: "cravings",
    label: "Cravings or urges I want to understand",
    weights: [{ trackId: "addiction_adjunct", weight: 3 }],
  },
  {
    id: "pain",
    label: "Pain that flares with stress or memories",
    weights: [{ trackId: "pain_somatic", weight: 3 }],
  },
  {
    id: "confidence",
    label: "Confidence for a specific upcoming situation",
    weights: [{ trackId: "performance_future", weight: 3 }],
  },
  {
    id: "recent",
    label: "Something distressing that happened recently",
    weights: [
      { trackId: "recent_event", weight: 3 },
      { trackId: "ptsd_trauma", weight: 1 },
    ],
  },
  {
    id: "numb",
    label: "Feeling numb, disconnected, or losing time",
    weights: [{ trackId: "complex_readiness", weight: 3 }],
  },
  {
    id: "self_talk",
    label: "Harsh self-talk, shame, or relationship patterns",
    weights: [
      { trackId: "ptsd_trauma", weight: 2 },
      { trackId: "depression_adjunct", weight: 1 },
    ],
  },
];
