import { getDb, newId } from "./db";
import { decryptField, encryptField } from "./crypto";
import {
  CompanionPrefs,
  ReadinessAssessment,
  SafetyPlan,
  TRACK_GUIDANCE,
  UserTrigger,
  getActiveTriggers,
  getCompanionPrefs,
  getLatestReadiness,
  getSafetyPlan,
  getWarningSigns,
} from "./profile";
import { CheckinRow, getTodayCheckin } from "./gating";
import { canExposeToModel, classifyMemory, decayState } from "./safety/memory";

// The Steady companion. It is not a therapist, doctor, or emergency
// responder; it provides grounding guidance, reflection prompts, and session
// preparation, and it must prioritize safety (feature spec section 14).
//
// This implementation is a deterministic rules engine over the member's
// structured memory — no external model call, so replies are auditable and
// the demo runs with no API key. An LLM provider can be slotted in behind
// generateReply() later; the safety routing below must stay in front of it.

export interface CompanionContext {
  userId: string;
  prefs: CompanionPrefs | null;
  triggers: UserTrigger[];
  warningSigns: string[];
  plan: SafetyPlan | null;
  checkin: CheckinRow | null;
  readiness: ReadinessAssessment | null;
  lastSession: {
    module_id: string;
    status: string;
    pre_suds: number | null;
    post_suds: number | null;
    started_at: string;
  } | null;
}

export function buildCompanionContext(userId: string): CompanionContext {
  const db = getDb();
  const lastSession = db
    .prepare(
      `SELECT module_id, status, pre_suds, post_suds, started_at
       FROM therapy_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 1`
    )
    .get(userId) as CompanionContext["lastSession"];
  return {
    userId,
    prefs: getCompanionPrefs(userId),
    triggers: getActiveTriggers(userId),
    warningSigns: getWarningSigns(userId),
    plan: getSafetyPlan(userId),
    checkin: getTodayCheckin(userId),
    readiness: getLatestReadiness(userId),
    lastSession: lastSession ?? null,
  };
}

// ---------- Structured memory ----------

export type MemoryType =
  | "trigger"
  | "grounding_tool"
  | "safety"
  | "readiness"
  | "tone_preference"
  | "restricted_topic"
  | "session_pattern"
  | "progress_pattern"
  | "focus_area";

export type MemorySource =
  | "onboarding"
  | "daily_checkin"
  | "session_reflection"
  | "user_message"
  | "specialist_note";

export interface MemoryItem {
  id: string;
  user_id: string;
  memory_type: MemoryType;
  memory_key: string;
  memory_value: string;
  source_type: MemorySource;
  source_id: string | null;
  active: number;
  created_at: string;
}

export function memoryEnabled(userId: string): boolean {
  return (getCompanionPrefs(userId)?.memory_enabled ?? "yes") === "yes";
}

export function writeMemory(args: {
  userId: string;
  type: MemoryType;
  key: string;
  value: string;
  source: MemorySource;
  sourceId?: string;
}) {
  if (!memoryEnabled(args.userId)) return;
  const db = getDb();
  const existing = db
    .prepare(
      "SELECT id FROM ai_memory_items WHERE user_id = ? AND memory_type = ? AND memory_key = ? AND active = 1"
    )
    .get(args.userId, args.type, args.key) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE ai_memory_items SET memory_value = ?, source_type = ?, source_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(encryptField(args.value), args.source, args.sourceId ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO ai_memory_items (id, user_id, memory_type, memory_key, memory_value, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(newId(), args.userId, args.type, args.key, encryptField(args.value), args.source, args.sourceId ?? null);
  }
}

export function getMemoryItems(userId: string): MemoryItem[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM ai_memory_items WHERE user_id = ? AND active = 1 ORDER BY memory_type, memory_key"
    )
    .all(userId) as MemoryItem[];
  return rows.map((r) => ({ ...r, memory_value: decryptField(r.memory_value) }));
}

/** Memories the MODEL may see. Enforces the memory taxonomy at the retrieval
 *  site (audit finding): Account/SafetyAudit classes never reach a prompt
 *  (canExposeToModel) and gracefully-forgotten items are dropped (decayState).
 *  The member still sees everything via getMemoryItems in Settings → Memory. */
export function getModelExposableMemoryItems(userId: string, nowMs = Date.now()): MemoryItem[] {
  return getMemoryItems(userId).filter((m) => {
    const c = classifyMemory(m.memory_type, m.source_type);
    if (!canExposeToModel(c.memoryClass)) return false;
    // created_at is SQLite datetime('now') UTC: "YYYY-MM-DD HH:MM:SS".
    const createdAtMs = new Date(m.created_at.replace(" ", "T") + "Z").getTime();
    return (
      decayState(
        {
          memoryClass: c.memoryClass,
          sensitive: c.sensitive,
          createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : nowMs,
          providerActive: true,
        },
        nowMs
      ) === "active"
    );
  });
}

export function getMemoryItemsByType(userId: string, type: MemoryType): MemoryItem[] {
  return getMemoryItems(userId).filter((m) => m.memory_type === type);
}

export function hasOnboardingConversation(userId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 AS one FROM ai_conversations WHERE user_id = ? AND context_type = 'onboarding' LIMIT 1"
    )
    .get(userId);
  return Boolean(row);
}

// ---------- Safety detection ----------

const CRISIS_PATTERNS = [
  /suicid/i,
  /kill (myself|me|him|her|them|someone)/i,
  /hurt (myself|someone|somebody|him|her|them)/i,
  /harm (myself|someone)/i,
  /end (it all|my life)/i,
  /don'?t want to (live|be here|be alive)/i,
  /self[- ]harm/i,
  /cutting myself/i,
  /not safe/i,
  /unsafe/i,
];

const HIGH_ACTIVATION_PATTERNS = [
  /panic/i,
  /can'?t breathe/i,
  /flashback/i,
  /not real/i,
  /unreal/i,
  /dissociat/i,
  /frozen/i,
  /shaking/i,
  /overwhelm/i,
  /spiraling/i,
];

export function detectRisk(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text));
}

function detectHighActivation(ctx: CompanionContext, text: string): boolean {
  if (HIGH_ACTIVATION_PATTERNS.some((p) => p.test(text))) return true;
  const c = ctx.checkin;
  return !!c && (c.activation >= 8 || c.dissociation >= 7 || c.recommended_action === "crisis");
}

// ---------- Reply generation ----------

export interface CompanionReply {
  text: string;
  riskFlag: boolean;
  mode: "crisis" | "grounding" | "readiness" | "trigger" | "reflection" | "general" | "ai";
}

function groundingTools(ctx: CompanionContext): string[] {
  if (!ctx.plan) return ["Breathing", "Walking"];
  try {
    const tools = JSON.parse(ctx.plan.grounding_tools_json) as string[];
    return tools.length > 0 ? tools : ["Breathing", "Walking"];
  } catch {
    return ["Breathing", "Walking"];
  }
}

function name(ctx: CompanionContext): string {
  return ctx.prefs?.preferred_user_name?.trim() || "";
}

function avoids(ctx: CompanionContext, item: string): boolean {
  try {
    return (JSON.parse(ctx.prefs?.avoidances_json ?? "[]") as string[]).includes(item);
  } catch {
    return false;
  }
}

// Apply tone and avoidance preferences. The companion suggests, never
// declares, and never implies failure.
function styled(ctx: CompanionContext, sentences: string[], closingQuestion?: string): string {
  const tone = ctx.prefs?.tone ?? "Gentle";
  let parts = [...sentences];
  if (tone === "Minimal" || avoids(ctx, "Long responses")) parts = parts.slice(0, 2);
  if (closingQuestion && !avoids(ctx, "Too many questions")) parts.push(closingQuestion);
  const n = name(ctx);
  if (n && (tone === "Warm" || tone === "Encouraging") && parts.length > 0) {
    const first = /^I['' ]/.test(parts[0])
      ? parts[0]
      : `${parts[0].charAt(0).toLowerCase()}${parts[0].slice(1)}`;
    parts[0] = `${n}, ${first}`;
  }
  return parts.join(" ");
}

// Companion-initiated opening for the daily chat that follows a check-in.
// Used when the AI companion is unavailable; the AI path composes its own
// opening from the same context.
export function generateCheckinOpening(ctx: CompanionContext): CompanionReply {
  const c = ctx.checkin;
  const tools = groundingTools(ctx).slice(0, 1);
  if (!c) {
    return {
      riskFlag: false,
      mode: "general",
      text: styled(
        ctx,
        ["I'm here.", "Today's check-in is the best first step — it takes under 90 seconds."],
        "Would you like to do it now?"
      ),
    };
  }
  const sentences: string[] = ["Thanks for checking in — I've read today's numbers."];
  if (c.sleep_quality <= 3) sentences.push("Sleep looks rough; that alone makes everything louder.");
  if (c.activation >= 7) sentences.push("Your activation is high today, so let's not ask too much of your system.");
  else if (c.shutdown >= 7) sentences.push("Things look heavy and slowed-down today, and that deserves gentleness.");
  if (c.recommended_action === "processing_ok") {
    sentences.push("Overall today looks steady, so cleared session modules are open if you want them — no pressure either way.");
  } else {
    sentences.push(
      tools.length > 0
        ? `Today looks like a day for steadiness first — ${tools[0].toLowerCase()} has helped you before.`
        : "Today looks like a day for steadiness first."
    );
  }
  return {
    riskFlag: false,
    mode: "general",
    text: styled(ctx, sentences, "How does today actually feel from the inside?"),
  };
}

export function generateReply(ctx: CompanionContext, userText: string): CompanionReply {
  // 1. Crisis routing always comes first and ignores tone preferences.
  if (detectRisk(userText)) {
    return {
      riskFlag: true,
      mode: "crisis",
      text:
        "Thank you for telling me. What you're describing matters more than anything else we could work on right now. I'm not able to provide crisis care, so please reach out now: call or text 988 (Suicide & Crisis Lifeline) or call 911 if you are in immediate danger. The crisis page has grounding steps while you reach out, and your care team will be notified. You are not failing by needing support.",
    };
  }

  // 2. High activation shifts out of processing mode into grounding.
  if (detectHighActivation(ctx, userText)) {
    const tools = groundingTools(ctx).slice(0, 2);
    const reminder = ctx.plan?.reminder_phrase;
    return {
      riskFlag: false,
      mode: "grounding",
      text: styled(
        ctx,
        [
          "This looks like a moment to pause, not push.",
          "Let's come back to the room first: feel your feet on the floor, and breathe out longer than you breathe in.",
          tools.length > 0
            ? `From your safety plan, ${tools.join(" and ").toLowerCase()} ${tools.length > 1 ? "have" : "has"} helped before.`
            : "",
          reminder ? `You asked me to remind you: “${reminder}”` : "",
        ].filter(Boolean),
        "Are your feet on the floor?"
      ),
    };
  }

  const lower = userText.toLowerCase();

  // 3. Readiness questions ("am I ready", "should I do a session today").
  if (/(ready|session today|should i (start|do|process)|processing today)/i.test(lower)) {
    const r = ctx.readiness;
    const c = ctx.checkin;
    const sentences: string[] = [];
    if (!c) {
      sentences.push("Before a session, Steady needs today's check-in — it takes under 90 seconds.");
    } else if (c.recommended_action === "processing_ok") {
      sentences.push("Today's check-in looks steady, so cleared modules are open if you want them.");
      sentences.push("There's no pressure either way — grounding first is always a fine choice.");
    } else {
      sentences.push("Your check-in suggests today may be better for grounding or a shorter preparation session.");
      sentences.push("Processing can wait. That isn't a setback — it's pacing.");
    }
    if (r) sentences.push(TRACK_GUIDANCE[r.recommended_track]);
    return {
      riskFlag: false,
      mode: "readiness",
      text: styled(ctx, sentences, "Would you like to ground first?"),
    };
  }

  // 4. Known trigger mentions: acknowledge and recall what has helped.
  const mentioned = ctx.triggers.find((t) => lower.includes(t.trigger_name.toLowerCase()));
  if (mentioned) {
    const tools = groundingTools(ctx).slice(0, 2);
    return {
      riskFlag: false,
      mode: "trigger",
      text: styled(
        ctx,
        [
          `That sounds like it may connect to one of your known triggers: ${mentioned.trigger_name.toLowerCase()}.`,
          "Naming it is already a steadying step.",
          tools.length > 0
            ? `Last time something like this showed up, ${tools[0].toLowerCase()} helped.`
            : "",
        ].filter(Boolean),
        "Would you like to use one of your grounding tools now?"
      ),
    };
  }

  // 5. Post-session reflection.
  if (/(after|finished|completed|reflect|session went|how did i do)/i.test(lower) && ctx.lastSession) {
    const s = ctx.lastSession;
    const sentences: string[] = [];
    if (s.pre_suds !== null && s.post_suds !== null) {
      sentences.push(`In your most recent session you started at a distress level of ${s.pre_suds} and ended at ${s.post_suds}.`);
      if (s.post_suds < s.pre_suds) sentences.push("That settling is worth noticing and saving.");
      else sentences.push("Distress that doesn't drop right away is information, not failure — your care team can see it too.");
    } else {
      sentences.push("Your last session is recorded, and your care team can see how it went.");
    }
    sentences.push("You do not need to solve everything today. Let your system settle.");
    return { riskFlag: false, mode: "reflection", text: styled(ctx, sentences) };
  }

  // 6. Default: short, calm, low-pressure.
  return {
    riskFlag: false,
    mode: "general",
    text: styled(
      ctx,
      [
        "I hear you.",
        "I'm here to help you ground, prepare for a session, or reflect — at whatever pace feels safe.",
      ],
      "What would feel most supportive right now: grounding, preparing, or just talking it through?"
    ),
  };
}
