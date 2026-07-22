import { newId } from "./db";
import { data } from "./data";
import { encryptField } from "./crypto";

// Onboarding fitness screener (compliance packet 4A): gatekeeping for a
// self-guided program with no humans on call. Mandatory before baseline
// screening and any session; cannot be skipped; a disqualifying answer
// triggers a 24-hour cooldown before retake.
//
// [CLINICAL ADVISOR REQUIRED: item wording, the hard-stop vs soft-flag
// mapping, and the cooldown length below are PLACEHOLDERS built from the
// packet's standard self-guided-EMDR exclusion list. They must be signed off
// by the EMDR-trained advisor (packet 3.6) before launch.]

export const FITNESS_SCREENER_ID = "fitness-screener";
export const FITNESS_SCREENER_VERSION = "fit-v1-placeholder";
export const RETAKE_COOLDOWN_HOURS = 24;

export type FitnessOutcome = "pass" | "soft_flag" | "hard_stop";

export interface FitnessItem {
  id: string;
  text: string;
  /** What a "yes" means for fit. */
  onYes: "hard_stop" | "soft_flag" | "none";
  /** Shown under the question, never judgmental. */
  note?: string;
}

export const FITNESS_ITEMS: FitnessItem[] = [
  {
    id: "selfharm_30d",
    text: "In the past 30 days, have you had suicidal thoughts or urges to harm yourself?",
    onYes: "hard_stop",
    note: "Honest answers route you to the right support — this one matters most.",
  },
  {
    id: "hospitalization_12m",
    text: "Have you been hospitalized for psychiatric care in the past 12 months?",
    onYes: "hard_stop",
  },
  {
    id: "psychotic_dissociative_dx",
    text: "Have you been diagnosed with a psychotic disorder or a dissociative disorder?",
    onYes: "hard_stop",
  },
  {
    id: "substance_coping",
    text: "Are you currently dependent on alcohol or other substances as a way to cope with difficult memories?",
    onYes: "hard_stop",
  },
  {
    id: "seizure_disorder",
    text: "Do you have a seizure disorder or photosensitive epilepsy?",
    onYes: "soft_flag",
    note: "You can still use Steady — sessions will default to audio-only bilateral stimulation instead of the moving dot.",
  },
  {
    id: "unsafe_situation",
    text: "Are you currently in a crisis, or living in a situation that is not safe?",
    onYes: "hard_stop",
  },
  {
    id: "under_18",
    text: "Are you under 18 years old?",
    onYes: "hard_stop",
    note: "Steady is for adults. This is also checked at account creation.",
  },
  {
    id: "acute_medical",
    text: "Are you experiencing pregnancy-related severe distress, or another acute medical condition that feels unstable right now?",
    onYes: "soft_flag",
    note: "A yes here doesn't screen you out — it points you to extra resources and a gentler pace.",
  },
];

export function classifyFitness(answers: Record<string, boolean>): {
  outcome: FitnessOutcome;
  flags: string[];
} {
  const flags: string[] = [];
  let outcome: FitnessOutcome = "pass";
  for (const item of FITNESS_ITEMS) {
    if (!answers[item.id]) continue;
    flags.push(`${item.onYes}:${item.id}`);
    if (item.onYes === "hard_stop") outcome = "hard_stop";
    else if (item.onYes === "soft_flag" && outcome !== "hard_stop") outcome = "soft_flag";
  }
  return { outcome, flags };
}

export interface FitnessState {
  status: "none" | "pass" | "soft_flag" | "cooldown";
  /** Hours remaining before a retake is allowed (cooldown only). */
  retakeInHours?: number;
  flags: string[];
}

// Latest screener result for gating. Responses are stored as coded values
// only (item id -> 0/1), never free text (packet 4A.2).
export async function getFitnessState(userId: string): Promise<FitnessState> {
  const c = await data();
  const row = (await c.get(
    `SELECT total_score, risk_flags_json, created_at FROM screenings
       WHERE user_id = ? AND instrument = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [userId, FITNESS_SCREENER_ID]
  )) as { total_score: number; risk_flags_json: string; created_at: string } | undefined;
  if (!row) return { status: "none", flags: [] };
  let flags: string[] = [];
  try {
    flags = JSON.parse(row.risk_flags_json) as string[];
  } catch {
    flags = [];
  }
  const hardStopped = flags.some((f) => f.startsWith("hard_stop:"));
  if (hardStopped) {
    const taken = new Date(row.created_at.replace(" ", "T") + "Z").getTime();
    const hoursSince = (Date.now() - taken) / 3600000;
    if (hoursSince < RETAKE_COOLDOWN_HOURS) {
      return {
        status: "cooldown",
        retakeInHours: Math.ceil(RETAKE_COOLDOWN_HOURS - hoursSince),
        flags,
      };
    }
    // Cooldown elapsed: treated as not yet screened so they may retake.
    return { status: "none", flags };
  }
  return { status: flags.length > 0 ? "soft_flag" : "pass", flags };
}

export async function hasSeizureFlag(userId: string): Promise<boolean> {
  return (await getFitnessState(userId)).flags.includes("soft_flag:seizure_disorder");
}

export async function recordFitnessScreening(userId: string, answers: Record<string, boolean>) {
  const { outcome, flags } = classifyFitness(answers);
  // Coded values only — item id to 0/1.
  const coded: Record<string, number> = {};
  for (const item of FITNESS_ITEMS) coded[item.id] = answers[item.id] ? 1 : 0;
  const c = await data();
  await c.run(
    `INSERT INTO screenings (id, user_id, instrument, instrument_version, total_score, answers_json, risk_flags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      userId,
      FITNESS_SCREENER_ID,
      FITNESS_SCREENER_VERSION,
      flags.length,
      encryptField(JSON.stringify(coded)),
      JSON.stringify(flags),
    ]
  );
  return { outcome, flags };
}
