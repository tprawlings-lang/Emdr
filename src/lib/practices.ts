// Practices — the shared "Prepare & Regulate" content service (roadmap §8).
// One content pattern serves meditation / movement / breathwork / sleep /
// soundscape to BOTH web and iOS: the backend defines practices, clients render
// them, and completions post back (feeding history, the daily plan, streaks, and
// companion memory). This first slice ships BREATHWORK, whose patterns are
// deterministic data (no produced media), so it needs no content pipeline.
//
// Definitions are code-defined (like MODULES / INSTRUMENTS) — reviewable in one
// place; only COMPLETIONS touch the DB. Trauma-safety (roadmap §9) is enforced
// here: no-breath-hold variants exist, holds are flagged, and titration surfaces
// gentler patterns first when today's check-in shows elevated dissociation.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { getTodayCheckin } from "./gating";
import { writeMemory } from "./companion";

export type PracticeType = "breathwork" | "meditation" | "movement" | "sleep" | "soundscape";

export interface BreathPhase {
  label: "inhale" | "hold" | "exhale" | "rest";
  seconds: number;
}

export interface Practice {
  id: string;
  type: PracticeType;
  title: string;
  intro: string;
  /** Suggested total length. Breathwork loops its phases to about this long. */
  durationSec: number;
  /** 1 = gentlest / most orienting, 3 = most activating. */
  intensity: 1 | 2 | 3;
  tags: string[];
  /** Breathwork: one cycle of phases (looped). Absent for other types. */
  phases?: BreathPhase[];
  /** True if the pattern includes a breath hold (titrated / avoidable). */
  hasHold: boolean;
  /** Short usage/safety note shown with the practice. */
  note?: string;
}

// ── Breathwork catalog (deterministic; no media). Ordered gentlest-first. ──
export const BREATHWORK: Practice[] = [
  {
    id: "coherent-5-5", type: "breathwork", title: "Coherent breathing",
    intro: "A smooth, even breath — about five and a half seconds in, five and a half out. No holding.",
    durationSec: 120, intensity: 1, tags: ["calming", "orienting", "anytime"], hasHold: false,
    phases: [{ label: "inhale", seconds: 5.5 }, { label: "exhale", seconds: 5.5 }],
    note: "Even and easy. If counting feels like too much, just let the breath slow.",
  },
  {
    id: "extended-exhale", type: "breathwork", title: "Longer exhale",
    intro: "Breathe in for four, out for six. A longer exhale gently settles the nervous system.",
    durationSec: 90, intensity: 1, tags: ["calming", "grounding", "no-hold"], hasHold: false,
    phases: [{ label: "inhale", seconds: 4 }, { label: "exhale", seconds: 6 }],
    note: "No breath-holding. Good when you feel activated.",
  },
  {
    id: "physiological-sigh", type: "breathwork", title: "Physiological sigh",
    intro: "Two breaths in through the nose — a full breath, then a small top-up — and a long breath out.",
    durationSec: 60, intensity: 1, tags: ["reset", "quick", "no-hold"], hasHold: false,
    phases: [{ label: "inhale", seconds: 2 }, { label: "inhale", seconds: 1 }, { label: "exhale", seconds: 6 }],
    note: "A fast reset for a spike of stress. No holding.",
  },
  {
    id: "box-4", type: "breathwork", title: "Box breathing",
    intro: "Equal counts of four: in, hold, out, hold. A steady, contained rhythm.",
    durationSec: 120, intensity: 2, tags: ["focus", "steadying"], hasHold: true,
    phases: [
      { label: "inhale", seconds: 4 }, { label: "hold", seconds: 4 },
      { label: "exhale", seconds: 4 }, { label: "hold", seconds: 4 },
    ],
    note: "Includes gentle breath holds. Skip to a no-hold pattern if holding feels uneasy.",
  },
  {
    id: "four-seven-eight", type: "breathwork", title: "4-7-8 breath",
    intro: "In for four, hold for seven, out for eight. A slower pattern often used for winding down.",
    durationSec: 114, intensity: 2, tags: ["sleep", "wind-down"], hasHold: true,
    phases: [{ label: "inhale", seconds: 4 }, { label: "hold", seconds: 7 }, { label: "exhale", seconds: 8 }],
    note: "Longer holds — best sitting or lying down. If you feel light-headed, return to normal breathing.",
  },
];

const ALL_PRACTICES: Practice[] = [...BREATHWORK];

/** Whether today's check-in indicates we should surface gentler, no-hold work
 *  first (roadmap §9 titration). Best-effort — defaults to false. */
async function shouldTitrate(userId: string): Promise<boolean> {
  const checkin = await getTodayCheckin(userId);
  if (!checkin) return false;
  const c = checkin as { dissociation?: number; activation?: number; recommended_action?: string };
  return (
    (c.dissociation ?? 0) >= 4 ||
    (c.activation ?? 0) >= 7 ||
    c.recommended_action === "grounding_only" ||
    c.recommended_action === "stabilization"
  );
}

/** List practices of a type, safety-ordered for the member's day. When today's
 *  check-in is elevated, no-hold / gentler (intensity 1) patterns come first. */
export async function listPractices(userId: string, type?: PracticeType): Promise<Practice[]> {
  const items = ALL_PRACTICES.filter((p) => !type || p.type === type);
  const titrate = await shouldTitrate(userId);
  return [...items].sort((a, b) => {
    if (titrate) {
      // Gentler day: no-hold before hold, then by intensity.
      if (a.hasHold !== b.hasHold) return a.hasHold ? 1 : -1;
    }
    return a.intensity - b.intensity;
  });
}

export function getPractice(id: string): Practice | undefined {
  return ALL_PRACTICES.find((p) => p.id === id);
}

/** Record a completed practice: a content-free row + audit, and a light
 *  companion-memory note so the daily plan / companion can reflect it. */
export async function recordPracticeCompletion(
  userId: string,
  practiceId: string,
  durationSec: number
): Promise<{ ok: boolean }> {
  const practice = getPractice(practiceId);
  if (!practice) return { ok: false };
  const secs = Math.max(0, Math.min(3600, Math.round(durationSec)));
  const c = await data();
  await c.run(
    "INSERT INTO practice_completions (id, user_id, practice_id, practice_type, duration_sec) VALUES (?, ?, ?, ?, ?)",
    [newId(), userId, practice.id, practice.type, secs]
  );
  await writeMemory({
    userId,
    type: "session_pattern",
    key: `regulated with ${practice.type}`,
    value: practice.title,
    source: "session_reflection",
  });
  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: "practice_completed", target: practice.id,
    detail: { type: practice.type, durationSec: secs },
  });
  return { ok: true };
}

/** Recent completion count (for streaks / "showed up" — roadmap F10/F12). */
export async function practiceCompletionCount(userId: string, sinceISO?: string): Promise<number> {
  const c = await data();
  const row = (await c.get(
    `SELECT COUNT(*) AS n FROM practice_completions WHERE user_id = ? ${sinceISO ? "AND created_at >= ?" : ""}`,
    sinceISO ? [userId, sinceISO] : [userId]
  )) as { n: number };
  return row?.n ?? 0;
}
