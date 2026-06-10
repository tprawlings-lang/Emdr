import { getDb } from "./db";
import { decryptField } from "./crypto";

// Onboarding profile system: trigger mapping, early warning signs, readiness
// assessment, and safety planning (feature spec sections 3–6). Catalogs are
// fixed vocabularies so the companion can match them deterministically; users
// can always add custom triggers.

export const TRIGGER_CATALOG: { category: string; label: string; triggers: string[] }[] = [
  {
    category: "relational",
    label: "Relational",
    triggers: [
      "Feeling ignored",
      "Feeling rejected",
      "Feeling criticized",
      "Feeling controlled",
      "Feeling abandoned",
      "Conflict",
      "Silence after vulnerability",
      "Someone raising their voice",
      "Someone being disappointed",
      "Feeling misunderstood",
    ],
  },
  {
    category: "environmental",
    label: "Environmental",
    triggers: [
      "Crowds",
      "Loud sounds",
      "Certain rooms or places",
      "Being trapped",
      "Driving",
      "Nighttime",
      "Closed doors",
      "Messy spaces",
      "Hospitals",
      "Workplaces",
    ],
  },
  {
    category: "body",
    label: "Body-based",
    triggers: [
      "Fast heartbeat",
      "Tight chest",
      "Nausea",
      "Fatigue",
      "Pain",
      "Feeling frozen",
      "Feeling disconnected from body",
      "Sexual touch",
      "Physical closeness",
    ],
  },
  {
    category: "memory",
    label: "Memory-based",
    triggers: [
      "Anniversaries",
      "Smells",
      "Songs",
      "Photos",
      "Specific words",
      "Family events",
      "Holidays",
      "Alcohol or substance use around others",
    ],
  },
  {
    category: "internal",
    label: "Internal",
    triggers: [
      "Shame",
      "Guilt",
      "Feeling like a burden",
      "Feeling powerless",
      "Feeling watched",
      "Not knowing what someone thinks",
      "Making a mistake",
      "Waiting for a response",
    ],
  },
];

export const TRIGGER_RESPONSES = [
  "Anxiety",
  "Anger",
  "Panic",
  "Numbness",
  "Shutdown",
  "People-pleasing",
  "Avoidance",
  "Dissociation",
  "Crying",
  "Overthinking",
  "Urge to isolate",
  "Urge to fix the situation",
];

export const WARNING_SIGNS = [
  "Tight chest",
  "Shallow breathing",
  "Jaw tension",
  "Racing thoughts",
  "Stomach drop",
  "Heat in face",
  "Numbness",
  "Sudden tiredness",
  "Wanting to leave",
  "Wanting reassurance",
  "Feeling unreal",
  "Feeling small",
  "Feeling angry",
  "Feeling frozen",
  "Trouble speaking",
];

export const GROUNDING_TOOLS = [
  "Cold water",
  "Weighted blanket",
  "Walking",
  "Music",
  "Breathing",
  "Journaling",
  "Calling someone",
  "Sitting outside",
  "Holding an object",
  "Prayer",
  "Stretching",
];

export const TRAUMA_AREAS = [
  "Childhood",
  "Family",
  "Relationships",
  "Work",
  "Grief",
  "Violence",
  "Medical trauma",
  "Religious or institutional trauma",
  "Neglect",
  "Emotional abuse",
  "Physical abuse",
  "Sexual trauma",
  "Prefer not to say",
];

export const GOALS = [
  "Daily grounding",
  "Understanding triggers",
  "Preparing for EMDR",
  "Support between therapy sessions",
  "Processing trauma safely",
  "Tracking patterns",
];

export const COMPANION_TONES = ["Gentle", "Direct", "Very calm", "Warm", "Minimal", "Encouraging"];

export const COMPANION_SUPPORT_MODES = [
  "Grounding me when I'm activated",
  "Helping me prepare for sessions",
  "Helping me reflect after sessions",
  "Noticing patterns",
  "Reminding me what works",
  "Helping me slow down",
  "Helping me decide if I'm ready today",
];

export const COMPANION_AVOIDANCES = [
  "Too many questions",
  "Spiritual language",
  "Clinical language",
  "Long responses",
  "Positive clichés",
];

// ---------- Row types ----------

export interface UserProfile {
  user_id: string;
  therapist_status: string | null;
  emdr_experience: string | null;
  goals_json: string;
  trauma_areas_json: string;
  restricted_topics_json: string;
  profile_complete: number;
}

export interface UserTrigger {
  id: string;
  user_id: string;
  trigger_name: string;
  trigger_category: string;
  intensity_score: number | null;
  common_responses_json: string;
  notes: string | null;
  active: number;
}

export interface SafetyPlan {
  user_id: string;
  grounding_tools_json: string;
  support_contact_name: string | null;
  support_contact_method: string | null;
  reminder_phrase: string | null;
  stop_signs: string | null;
  careful_topics: string | null;
}

export interface CompanionPrefs {
  user_id: string;
  preferred_user_name: string | null;
  tone: string;
  support_modes_json: string;
  avoidances_json: string;
  memory_enabled: string;
}

export interface ReadinessAssessment {
  id: string;
  user_id: string;
  stability_score: number;
  body_safety_score: number;
  present_connection_score: number;
  symptom_intensity_score: number;
  sleep_quality: string;
  support_available: string;
  processing_readiness: string;
  pause_capacity: string;
  pace_preference: string | null;
  risk_flag: string;
  calculated_readiness_score: number;
  recommended_track: ReadinessTrack;
  source: string;
  created_at: string;
}

// ---------- Lookups ----------

export function getProfile(userId: string): UserProfile | null {
  const row = getDb()
    .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
    .get(userId) as UserProfile | undefined;
  return row ?? null;
}

export function profileComplete(userId: string): boolean {
  return (getProfile(userId)?.profile_complete ?? 0) === 1;
}

export function getActiveTriggers(userId: string): UserTrigger[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM user_triggers WHERE user_id = ? AND active = 1 ORDER BY intensity_score DESC, trigger_name"
    )
    .all(userId) as UserTrigger[];
  return rows.map((r) => ({ ...r, notes: decryptField(r.notes) }));
}

export function getWarningSigns(userId: string): string[] {
  const rows = getDb()
    .prepare("SELECT sign_name FROM early_warning_signs WHERE user_id = ? AND active = 1")
    .all(userId) as { sign_name: string }[];
  return rows.map((r) => r.sign_name);
}

export function getSafetyPlan(userId: string): SafetyPlan | null {
  const row = getDb()
    .prepare("SELECT * FROM safety_plans WHERE user_id = ?")
    .get(userId) as SafetyPlan | undefined;
  if (!row) return null;
  return {
    ...row,
    reminder_phrase: decryptField(row.reminder_phrase),
    stop_signs: decryptField(row.stop_signs),
    careful_topics: decryptField(row.careful_topics),
  };
}

export function getCompanionPrefs(userId: string): CompanionPrefs | null {
  const row = getDb()
    .prepare("SELECT * FROM ai_companion_preferences WHERE user_id = ?")
    .get(userId) as CompanionPrefs | undefined;
  return row ?? null;
}

export function getLatestReadiness(userId: string): ReadinessAssessment | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM readiness_assessments WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"
    )
    .get(userId) as ReadinessAssessment | undefined;
  return row ?? null;
}

// ---------- Readiness scoring (feature spec section 5) ----------

export type ReadinessTrack = "stabilization" | "preparation" | "gentle_processing" | "full";

export const TRACK_LABELS: Record<ReadinessTrack, string> = {
  stabilization: "Stabilization",
  preparation: "Preparation",
  gentle_processing: "Gentle processing",
  full: "Full module access",
};

export interface ReadinessAnswers {
  stability: number; // 0–10
  bodySafety: number; // 0–10
  presentConnection: number; // 0–10
  symptomIntensity: number; // 0–10, higher = worse
  sleepQuality: "good" | "okay" | "poor" | "very_poor";
  supportAvailable: "yes" | "sometimes" | "no";
  processingReadiness: "ready" | "curious" | "unsure" | "overwhelmed" | "not_now";
  pauseCapacity: "yes" | "think_so" | "not_sure" | "no";
  riskFlag: "none" | "safe_now" | "not_safe";
}

const SLEEP_POINTS = { good: 10, okay: 6.5, poor: 3, very_poor: 0 } as const;
const SUPPORT_POINTS = { yes: 10, sometimes: 5, no: 0 } as const;
const READINESS_POINTS = { ready: 10, curious: 7.5, unsure: 5, overwhelmed: 2.5, not_now: 0 } as const;
const PAUSE_POINTS = { yes: 10, think_so: 6.5, not_sure: 3.5, no: 0 } as const;

// Weighted 0–100 score. Risk flags cap the score so a high self-report can
// never route an at-risk user into processing. "not_safe" is handled before
// scoring: it routes to crisis support, not to a track.
export function computeReadiness(a: ReadinessAnswers): { score: number; track: ReadinessTrack } {
  const raw =
    a.stability * 1.5 + // 15
    a.bodySafety * 1.5 + // 15
    a.presentConnection * 1.0 + // 10
    (10 - a.symptomIntensity) * 1.5 + // 15
    SLEEP_POINTS[a.sleepQuality] * 1.0 + // 10
    SUPPORT_POINTS[a.supportAvailable] * 1.0 + // 10
    READINESS_POINTS[a.processingReadiness] * 1.5 + // 15
    PAUSE_POINTS[a.pauseCapacity] * 1.0; // 10

  let score = Math.round(Math.max(0, Math.min(100, raw)));
  if (a.riskFlag === "not_safe") score = 0;
  else if (a.riskFlag === "safe_now") score = Math.min(score, 30);
  // Users who can't reliably stop an exercise stay out of processing tracks.
  if (a.pauseCapacity === "no") score = Math.min(score, 60);

  const track: ReadinessTrack =
    score <= 30 ? "stabilization" : score <= 60 ? "preparation" : score <= 80 ? "gentle_processing" : "full";
  return { score, track };
}

// Daily recalculation (spec: "recalculate readiness over time based on daily
// check-ins"). Today's somatic state comes from the check-in; the slower-moving
// answers (support, self-reported readiness, pause capacity) carry over from
// the latest stored assessment.
export function readinessFromCheckin(
  base: ReadinessAssessment,
  c: {
    activation: number;
    shutdown: number;
    harm_urge: boolean;
    feels_safe: boolean;
    dissociation: number;
    sleep_quality: number;
  }
): ReadinessAnswers {
  const sleep: ReadinessAnswers["sleepQuality"] =
    c.sleep_quality >= 7 ? "good" : c.sleep_quality >= 5 ? "okay" : c.sleep_quality >= 3 ? "poor" : "very_poor";
  return {
    stability: Math.max(0, 10 - Math.max(c.activation, c.shutdown)),
    bodySafety: c.feels_safe ? Math.max(0, 10 - c.dissociation) : 1,
    presentConnection: Math.max(0, 10 - c.dissociation),
    symptomIntensity: Math.max(c.activation, c.shutdown, c.dissociation),
    sleepQuality: sleep,
    supportAvailable: base.support_available as ReadinessAnswers["supportAvailable"],
    processingReadiness: base.processing_readiness as ReadinessAnswers["processingReadiness"],
    pauseCapacity: base.pause_capacity as ReadinessAnswers["pauseCapacity"],
    riskFlag: c.harm_urge || !c.feels_safe ? "safe_now" : "none",
  };
}

// Soft track copy — the product never implies failure (spec section 18).
export const TRACK_GUIDANCE: Record<ReadinessTrack, string> = {
  stabilization:
    "Today looks like a grounding day. Processing can wait — grounding, safety planning, and your companion are here.",
  preparation:
    "A preparation season: trigger awareness, grounding, and gentle reflection before deeper work.",
  gentle_processing:
    "Low-intensity processing is available when your daily check-in clears it. Move at the pace your nervous system can trust.",
  full: "All modules are available, still paced by your daily check-in and specialist review.",
};
