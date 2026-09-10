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

/**
 * Whether a clinician has ratified the items above — and, until one has, the
 * fact that a live gate is running on criteria nobody approved.
 *
 * THE SUFFIX WAS DOING THIS JOB AND SHOULD NOT HAVE BEEN. `fit-v1-placeholder`
 * is a string, and the only thing standing between a reader and the belief that
 * these criteria are clinically settled was four syllables at the end of it. It
 * travels a long way for a string: it is stamped on every stored screening row,
 * and `/api/mobile/v1/screener` serves it to a client that has no idea what the
 * suffix means. A caller reading `version: "fit-v1-placeholder"` from JSON has
 * to already know the convention to know they are being warned.
 *
 * SO THE STATE IS DATA, in the same shape the clinical policy already uses for
 * exactly this: an approval with a named owner, null until somebody signs it.
 * §34's rule for planning thresholds — a named owner and an approval date
 * before rules may fire — is the same rule, and this gate has been firing
 * without one.
 *
 * WHAT IT DOES NOT DO IS TURN THE GATE OFF, and that is deliberate rather than
 * a compromise. These items came from the compliance packet's standard
 * self-guided-EMDR exclusion list; running them unapproved is a considered
 * position, and a screener that refused to run until a signature existed would
 * open self-guided processing to everybody in the meantime. Withholding the
 * gate is worse than running a provisional one. What was missing is that
 * nobody could SEE they were provisional.
 */
export interface ScreenerApproval {
  /** Null until an EMDR-trained clinical advisor ratifies the items, the
   *  hard-stop mapping and the cooldown (compliance packet 3.6). */
  approvedBy: string | null;
  approvedAt: string | null;
  /** What a reviewer would be signing off, so the ask is a list rather than a
   *  conversation. */
  covers: string[];
}

export const FITNESS_SCREENER_APPROVAL: ScreenerApproval = {
  approvedBy: null,
  approvedAt: null,
  covers: [
    "the wording of each item",
    "which answers are a hard stop and which are a soft flag",
    "the 24-hour cooldown before a retake",
  ],
};

export function screenerApproved(a: ScreenerApproval = FITNESS_SCREENER_APPROVAL): boolean {
  return a.approvedBy !== null && a.approvedAt !== null;
}

/** Said in the words a reader needs, wherever the version travels. Returns null
 *  once it is approved, so a surface renders nothing rather than a stale
 *  caveat. */
export function screenerCaveat(a: ScreenerApproval = FITNESS_SCREENER_APPROVAL): string | null {
  if (screenerApproved(a)) return null;
  return (
    "PROVISIONAL — not clinically approved. These questions decide whether somebody may " +
    "run self-guided processing at all, and no EMDR-trained clinician has yet ratified " +
    `${a.covers.join(", ")}. They are running because withholding the gate would be worse ` +
    "than running a provisional one, not because they are settled."
  );
}

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
