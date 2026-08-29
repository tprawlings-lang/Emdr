// Autopilot — the Premium autonomous care loop (pricing Phase C).
//
// Plus REMEMBERS you between sessions; Premium ACTS between them. Autopilot
// composes a concrete plan for the member's day from everything Steady already
// knows (today's check-in, the program plan, practice history, unread lessons,
// measure trends), reaches out through the companion when signals warrant, and
// surfaces the safety engine's pacing as a benefit the member can see.
//
// Design constraints, in order:
//   - SAFETY FIRST AND UNCHANGED. Autopilot only ever narrows a day (gentler
//     practices, sessions set aside); it never opens anything the gates would
//     not — every session item is passed through checkModuleAccess, the same
//     gate the session player enforces server-side. Crisis days compose a
//     support-only plan.
//   - Deterministic and auditable. No model call composes a plan; the same
//     inputs produce the same plan, and every outreach is a coded, audited
//     event with cooldowns.
//   - Honest delivery. With no push channel yet, "reaches out" means the
//     message is waiting — in the companion thread and on the plan — the
//     moment the app opens. Composition happens lazily on the first open of
//     the day, which is exactly when it can first be seen.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { encryptField } from "./crypto";
import { getEntitlements } from "./entitlements";
import { getTodayCheckin, checkModuleAccess } from "./gating";
import { getModule, MODULES } from "./modules";
import { listPractices, practiceCompletionCount, type Practice } from "./practices";
import { LESSONS, readLessonIds, lessonsForModule } from "./lessons";
import { getProgramPlan } from "./program-plan";

// ---------- Types ----------

export interface AutopilotItem {
  kind: "checkin" | "practice" | "session" | "lesson" | "ground";
  title: string;
  detail: string;
  href: string;
}

export interface AutopilotPlan {
  date: string;
  headline: string;
  /** How Autopilot adjusted today — the adaptive-pacing benefit, made visible. */
  pacingNote: string | null;
  items: AutopilotItem[];
  /** Proactive outreach delivered with today's plan (also in the companion thread). */
  outreach: string | null;
}

// ---------- Cooldown ledger ----------

const OUTREACH_GLOBAL_MS = 3 * 86400000;
const OUTREACH_KIND_MS = 7 * 86400000;
const RISK_WATCH_MS = 14 * 86400000;

function sqliteToMs(ts: string): number {
  return new Date(ts.replace(" ", "T") + "Z").getTime();
}

async function lastEvent(userId: string, kind?: string): Promise<number | null> {
  const c = await data();
  const row = (await c.get(
    kind
      ? "SELECT created_at FROM autopilot_events WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1"
      : "SELECT created_at FROM autopilot_events WHERE user_id = ? AND kind != 'risk_watch' ORDER BY created_at DESC LIMIT 1",
    kind ? [userId, kind] : [userId]
  )) as { created_at: string } | undefined;
  return row ? sqliteToMs(row.created_at) : null;
}

async function recordEvent(userId: string, kind: string) {
  const c = await data();
  await c.run("INSERT INTO autopilot_events (id, user_id, kind) VALUES (?, ?, ?)", [newId(), userId, kind]);
}

// ---------- Outreach signals ----------

interface Outreach {
  kind: "missed_checkins" | "measure_worsening" | "streak_milestone";
  message: string;
  /** Also open a clinician risk-watch alert. */
  riskWatch: boolean;
}

const WORSENING_DELTAS: Record<string, number> = { "pcl-5": 10, itq: 8, "phq-9": 5, "gad-7": 5 };

/** Deterministic outreach decision. Checked in priority order; at most one. */
async function pickOutreach(userId: string): Promise<Outreach | null> {
  const c = await data();

  // Days since the last check-in (excluding today).
  const lastCheckin = (await c.get(
    "SELECT checkin_date FROM checkins WHERE user_id = ? AND checkin_date < date('now') ORDER BY checkin_date DESC LIMIT 1",
    [userId]
  )) as { checkin_date: string } | undefined;
  const everCheckedIn = Boolean(
    await c.get("SELECT 1 AS one FROM checkins WHERE user_id = ? LIMIT 1", [userId])
  );
  if (everCheckedIn && lastCheckin) {
    const gapDays = Math.floor((Date.now() - new Date(lastCheckin.checkin_date + "T00:00:00Z").getTime()) / 86400000);
    if (gapDays >= 3 && !(await getTodayCheckin(userId))) {
      return {
        kind: "missed_checkins",
        message:
          "I noticed it's been a few days — no pressure at all, and nothing is lost. If today has any room in it, a 90-second check-in is enough to start, and I'll shape the day around whatever it says. It's good to have you here.",
        riskWatch: false,
      };
    }
  }

  // Worsening on a tracked measure: compare the two most recent scores of the
  // same instrument.
  const rows = (await c.all(
    `SELECT instrument, total_score, created_at FROM screenings
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    [userId]
  )) as { instrument: string; total_score: number }[];
  const seen = new Map<string, number[]>();
  for (const r of rows) {
    const list = seen.get(r.instrument) ?? [];
    if (list.length < 2) { list.push(r.total_score); seen.set(r.instrument, list); }
  }
  for (const [instrument, scores] of seen) {
    const delta = WORSENING_DELTAS[instrument];
    if (delta && scores.length === 2 && scores[0] - scores[1] >= delta) {
      return {
        kind: "measure_worsening",
        message:
          "Your recent measures suggest the last stretch has been heavier, and I want you to know that's been seen — by me and by your care team. Nothing is wrong with you; hard stretches are part of this work. Today's plan stays gentle, and if you feel up to it, tell me what the past week has actually been like.",
        riskWatch: true,
      };
    }
  }

  // A steady week of practice deserves naming.
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace("T", " ");
  if ((await practiceCompletionCount(userId, weekAgo)) >= 5) {
    return {
      kind: "streak_milestone",
      message:
        "Something worth naming: you've shown up for your practices five times or more this past week. That kind of steady, unremarkable consistency is exactly what rewires a nervous system. I see it.",
      riskWatch: false,
    };
  }
  return null;
}

/** Deliver outreach into the member's companion thread so it's waiting the
 *  next time they open the chat — the companion speaking first. */
async function deliverOutreach(userId: string, o: Outreach) {
  const c = await data();
  const existing = (await c.get(
    "SELECT id FROM ai_conversations WHERE user_id = ? AND context_type = 'general' ORDER BY started_at DESC LIMIT 1",
    [userId]
  )) as { id: string } | undefined;
  const convId = existing?.id ?? newId();
  if (!existing) {
    await c.run("INSERT INTO ai_conversations (id, user_id, context_type) VALUES (?, ?, 'general')", [convId, userId]);
  }
  await c.run(
    "INSERT INTO ai_messages (id, conversation_id, user_id, sender, message_text, risk_flag) VALUES (?, ?, ?, 'companion', ?, 0)",
    [newId(), convId, userId, encryptField(o.message)]
  );
  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: "autopilot_outreach", target: convId, detail: { kind: o.kind },
  });
}

/** Continuous risk watch: pre-empt by telling the care team early. Coded
 *  types only — never member content (compliance 4B.4). */
async function maybeRiskWatch(userId: string, reason: string) {
  const last = await lastEvent(userId, "risk_watch");
  if (last !== null && Date.now() - last < RISK_WATCH_MS) return;
  const c = await data();
  await c.run("INSERT INTO alerts (id, user_id, alert_type, severity, detail) VALUES (?, ?, ?, ?, ?)", [
    newId(), userId, "autopilot_risk_watch", "moderate",
    `Autopilot risk watch: ${reason}. Surfaced early for review; the member's plan has been kept gentle.`,
  ]);
  await recordEvent(userId, "risk_watch");
  await audit({
    actorId: userId, actorRole: "member", family: "safety",
    type: "autopilot_risk_watch", detail: { reason },
  });
}

// ---------- Plan composition ----------

async function pickPractice(userId: string, type: "breathwork" | "meditation" | "movement"): Promise<Practice | null> {
  const list = await listPractices(userId, type);
  return list[0] ?? null;
}

async function pickLesson(userId: string, moduleId?: string): Promise<{ id: string; title: string; readMinutes: number } | null> {
  const read = new Set(await readLessonIds(userId));
  const pool = moduleId ? lessonsForModule(moduleId).filter((l) => !read.has(l.id)) : [];
  const fallback = LESSONS.filter((l) => !read.has(l.id));
  const lesson = pool[0] ?? fallback[0] ?? null;
  return lesson ? { id: lesson.id, title: lesson.title, readMinutes: lesson.readMinutes } : null;
}

/** The first program-plan step the member is actually cleared for TODAY —
 *  Autopilot proposes, the same server-side gates dispose. */
async function pickSessionStep(userId: string): Promise<{ moduleId: string; name: string; focus: string } | null> {
  const planRow = await getProgramPlan(userId);
  const candidates = planRow?.plan.nextSteps ?? [];
  for (const step of candidates) {
    const mod = getModule(step.moduleId);
    if (!mod) continue;
    const access = await checkModuleAccess(userId, mod);
    if (access.allowed) return { moduleId: mod.id, name: mod.name, focus: step.focus };
  }
  // No plan (or nothing cleared): resourcing is the always-appropriate base.
  const resourcing = MODULES.find((m) => m.id === "calm-place");
  if (resourcing) {
    const access = await checkModuleAccess(userId, resourcing);
    if (access.allowed) return { moduleId: resourcing.id, name: resourcing.name, focus: "Strengthen your calm base" };
  }
  return null;
}

async function compose(userId: string, checkinState: string): Promise<AutopilotPlan> {
  const today = new Date().toISOString().slice(0, 10);
  const items: AutopilotItem[] = [];
  let headline: string;
  let pacingNote: string | null = null;

  if (checkinState === "none") {
    headline = "Let's see where you are today";
    items.push({
      kind: "checkin",
      title: "Start with your check-in",
      detail: "90 seconds. The rest of this plan takes its shape from it.",
      href: "/app/check-in",
    });
    const breath = await pickPractice(userId, "breathwork");
    if (breath) {
      items.push({
        kind: "practice", title: breath.title,
        detail: "A few minutes to settle before anything else.",
        href: "/app/activities/breathe",
      });
    }
    const lesson = await pickLesson(userId);
    if (lesson) {
      items.push({
        kind: "lesson", title: lesson.title,
        detail: `A ${lesson.readMinutes}-minute read for whenever suits.`,
        href: `/app/learn/${lesson.id}`,
      });
    }
  } else if (checkinState === "crisis") {
    headline = "Today is about support, nothing else";
    pacingNote = "Autopilot has set everything else aside. Your care team has today's check-in.";
    items.push({
      kind: "ground", title: "Come back to the room",
      detail: "One step at a time, with your own grounding tools.",
      href: "/app/ground",
    });
  } else if (checkinState === "grounding_only") {
    headline = "A gentle day, on purpose";
    pacingNote =
      "Autopilot kept today to grounding: sessions are set aside, and the gentlest practices come first — protecting your window is progress too.";
    const med = await pickPractice(userId, "meditation");
    if (med) {
      items.push({
        kind: "practice", title: med.title,
        detail: "Eyes open, feet on the floor — orienting comes before anything deeper.",
        href: "/app/activities/meditate",
      });
    }
    items.push({
      kind: "ground", title: "Your grounding tools",
      detail: "The ones that have worked before, in one place.",
      href: "/app/ground",
    });
    const lesson = await pickLesson(userId, "grounding-nervous-system");
    if (lesson) {
      items.push({
        kind: "lesson", title: lesson.title,
        detail: `Understanding what your body is doing — ${lesson.readMinutes} minutes.`,
        href: `/app/learn/${lesson.id}`,
      });
    }
  } else {
    // stabilization | processing_ok
    const stabilizing = checkinState === "stabilization";
    headline = stabilizing ? "Steady work, kept within range" : "Your window looks steady — let's use it well";
    pacingNote = stabilizing
      ? "Autopilot set processing aside for today and lined up stabilization instead — intensity follows your check-in, not the calendar."
      : "Nothing needed adjusting today: your check-in shows room to work, so the program moves forward as planned.";
    const breath = await pickPractice(userId, "breathwork");
    if (breath) {
      items.push({
        kind: "practice", title: `Prepare: ${breath.title}`,
        detail: "A short on-ramp so the session starts from settled.",
        href: "/app/activities/breathe",
      });
    }
    const step = await pickSessionStep(userId);
    if (step) {
      items.push({
        kind: "session", title: step.name,
        detail: `Today's focus: ${step.focus}`,
        href: `/app/session/${step.moduleId}`,
      });
    }
    const lesson = await pickLesson(userId, step?.moduleId);
    if (lesson) {
      items.push({
        kind: "lesson", title: lesson.title,
        detail: `${lesson.readMinutes} minutes, before or after the session.`,
        href: `/app/learn/${lesson.id}`,
      });
    }
  }

  return { date: today, headline, pacingNote, items, outreach: null };
}

// ---------- Public API ----------

/** Today's Autopilot plan for a Premium member (null otherwise). Composed
 *  lazily on the first open of the day, recomposed when the check-in state
 *  changes (so checking in mid-morning reshapes the afternoon), and stable
 *  otherwise. Outreach and risk-watch side effects run at most once per day,
 *  on first composition. */
export async function getAutopilotPlan(userId: string): Promise<AutopilotPlan | null> {
  const ent = await getEntitlements(userId);
  if (!ent?.autopilot) return null;

  const c = await data();
  const today = new Date().toISOString().slice(0, 10);
  const checkin = await getTodayCheckin(userId);
  const state = (checkin?.recommended_action as string | undefined) ?? "none";

  const existing = (await c.get(
    "SELECT checkin_state, plan_json FROM autopilot_plans WHERE user_id = ? AND plan_date = ?",
    [userId, today]
  )) as { checkin_state: string; plan_json: string } | undefined;

  if (existing && existing.checkin_state === state) {
    try {
      return JSON.parse(existing.plan_json) as AutopilotPlan;
    } catch {
      // fall through to recompose
    }
  }

  const plan = await compose(userId, state);

  if (!existing) {
    // First composition of the day: consider outreach + risk watch.
    const globalLast = await lastEvent(userId);
    if (globalLast === null || Date.now() - globalLast >= OUTREACH_GLOBAL_MS) {
      const o = await pickOutreach(userId);
      if (o) {
        const kindLast = await lastEvent(userId, o.kind);
        if (kindLast === null || Date.now() - kindLast >= OUTREACH_KIND_MS) {
          await deliverOutreach(userId, o);
          await recordEvent(userId, o.kind);
          plan.outreach = o.message;
          if (o.riskWatch) await maybeRiskWatch(userId, o.kind);
        }
      }
    }
    await c.run(
      "INSERT INTO autopilot_plans (user_id, plan_date, checkin_state, plan_json) VALUES (?, ?, ?, ?)",
      [userId, today, state, JSON.stringify(plan)]
    );
    await audit({
      actorId: userId, actorRole: "member", family: "clinical",
      type: "autopilot_plan_composed", detail: { state, items: plan.items.length, outreach: plan.outreach ? "yes" : "no" },
    });
  } else {
    // Check-in state changed: recompose, but keep the day's outreach.
    try {
      const prior = JSON.parse(existing.plan_json) as AutopilotPlan;
      plan.outreach = prior.outreach;
    } catch { /* keep null */ }
    await c.run(
      "UPDATE autopilot_plans SET checkin_state = ?, plan_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND plan_date = ?",
      [state, JSON.stringify(plan), userId, today]
    );
    await audit({
      actorId: userId, actorRole: "member", family: "clinical",
      type: "autopilot_plan_recomposed", detail: { state },
    });
  }
  return plan;
}
