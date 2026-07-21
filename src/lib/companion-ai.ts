import Anthropic from "@anthropic-ai/sdk";
import { getDb, newId } from "./db";
import { decryptField, encryptField } from "./crypto";
import {
  CompanionContext,
  CompanionReply,
  MemoryType,
  getMemoryItems,
  memoryEnabled,
  writeMemory,
} from "./companion";
import { TRACK_LABELS, getProfile } from "./profile";
import { getProgramPlan } from "./program-plan";

// LLM-backed companion. The deterministic safety routing in actions.ts
// (crisis regex → canned crisis reply + alert) always runs BEFORE this module,
// and the rules engine in companion.ts remains the fallback when no API key
// is configured or the API call fails — the demo never hard-depends on the
// network.

const MODEL = process.env.EMDR_COMPANION_MODEL ?? "claude-opus-4-8";

export function aiCompanionEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------- Tools the companion can use to persist what it learns ----------

const TRIGGER_CATEGORIES = ["relational", "environmental", "body", "memory", "internal", "other"];

function tools(memoryOn: boolean): Anthropic.Tool[] {
  const list: Anthropic.Tool[] = [
    {
      name: "record_trigger",
      description:
        "Save or update one of the member's triggers in their trigger map. Call this whenever the member describes a trigger in any detail — what sets them off, how intense it is, how their body or behavior responds, or context worth keeping. Use the member's own words for notes where possible. If the trigger already exists, the fields you provide update it, so it is always safe to call with new detail.",
      input_schema: {
        type: "object",
        properties: {
          trigger_name: {
            type: "string",
            description: "Short name for the trigger, e.g. 'Someone raising their voice'",
          },
          trigger_category: {
            type: "string",
            enum: TRIGGER_CATEGORIES,
            description: "Which part of life the trigger belongs to",
          },
          intensity_score: {
            type: "integer",
            description: "How intense the reaction is, 1 (mild) to 10 (overwhelming), if the member indicated it",
          },
          common_responses: {
            type: "array",
            items: { type: "string" },
            description: "How the member typically responds, e.g. 'Shutdown', 'Panic', 'Urge to isolate'",
          },
          notes: {
            type: "string",
            description: "What the member shared about this trigger — context, history, what helps",
          },
        },
        required: ["trigger_name", "trigger_category"],
      },
    },
  ];
  if (memoryOn) {
    list.push({
      name: "remember",
      description:
        "Store a durable fact about the member so future conversations can build on it. Call this when the member shares something worth carrying forward: a grounding tool that works or doesn't, a preference about how to be spoken to, a pattern you notice across sessions or check-ins, a topic to avoid, or progress worth celebrating later. Use memory_type 'focus_area' when the member names something they specifically want to work on — those are offered back as focus choices before their therapy sessions. Use 'grounding_tool' with key 'calm place' for their calm-place image. Do not store crisis content or anything the member asked you to forget.",
      input_schema: {
        type: "object",
        properties: {
          memory_type: {
            type: "string",
            enum: [
              "trigger",
              "grounding_tool",
              "safety",
              "readiness",
              "tone_preference",
              "restricted_topic",
              "session_pattern",
              "progress_pattern",
              "focus_area",
            ],
          },
          key: {
            type: "string",
            description: "Short stable label, e.g. 'cold water', 'sunday evenings', 'work deadlines'",
          },
          value: {
            type: "string",
            description: "The fact to remember, one or two sentences, in plain language",
          },
        },
        required: ["memory_type", "key", "value"],
      },
    });
  }
  list.push({
    name: "escalate_risk",
    description:
      "Call this if the member expresses suicidal thoughts, intent to harm themselves or others, or says they are not safe — even indirectly. This notifies their care team. After calling it, your reply must direct them to call or text 988, call 911 if in immediate danger, and use the in-app crisis page.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief description of the risk language, for the care team" },
      },
      required: ["reason"],
    },
  });
  return list;
}

function executeTool(
  userId: string,
  convId: string,
  name: string,
  input: Record<string, unknown>,
  state: { riskFlag: boolean }
): string {
  const db = getDb();
  if (name === "record_trigger") {
    const triggerName = String(input.trigger_name ?? "").trim().slice(0, 120);
    if (!triggerName) return "Ignored: trigger_name was empty.";
    const category = TRIGGER_CATEGORIES.includes(String(input.trigger_category))
      ? String(input.trigger_category)
      : "other";
    const intensity =
      typeof input.intensity_score === "number"
        ? Math.max(1, Math.min(10, Math.round(input.intensity_score)))
        : null;
    const responses = Array.isArray(input.common_responses)
      ? (input.common_responses as unknown[]).map(String).slice(0, 12)
      : null;
    const notes = input.notes ? String(input.notes).slice(0, 2000) : null;
    const existing = db
      .prepare("SELECT id, common_responses_json, notes FROM user_triggers WHERE user_id = ? AND trigger_name = ?")
      .get(userId, triggerName) as { id: string; common_responses_json: string; notes: string | null } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE user_triggers SET trigger_category = ?, intensity_score = COALESCE(?, intensity_score),
         common_responses_json = COALESCE(?, common_responses_json), notes = COALESCE(?, notes),
         active = 1, updated_at = datetime('now') WHERE id = ?`
      ).run(category, intensity, responses ? JSON.stringify(responses) : null, encryptField(notes), existing.id);
      return `Updated trigger "${triggerName}".`;
    }
    db.prepare(
      `INSERT INTO user_triggers (id, user_id, trigger_name, trigger_category, intensity_score, common_responses_json, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(newId(), userId, triggerName, category, intensity, JSON.stringify(responses ?? []), encryptField(notes));
    return `Saved new trigger "${triggerName}".`;
  }
  if (name === "remember") {
    if (!memoryEnabled(userId)) return "Memory is turned off for this member; nothing stored.";
    const key = String(input.key ?? "").trim().slice(0, 120);
    const value = String(input.value ?? "").trim().slice(0, 1000);
    if (!key || !value) return "Ignored: key and value are required.";
    writeMemory({
      userId,
      type: input.memory_type as MemoryType,
      key,
      value,
      source: "user_message",
      sourceId: convId,
    });
    return `Remembered: ${key}.`;
  }
  if (name === "escalate_risk") {
    state.riskFlag = true;
    return "Care team notified. Now direct the member to 988 / 911 and the crisis page.";
  }
  return `Unknown tool: ${name}`;
}

// ---------- Context → system prompt ----------

function parseJsonArray(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function buildSystemPrompt(ctx: CompanionContext, contextType: string): string {
  const prefs = ctx.prefs;
  const memories = getMemoryItems(ctx.userId);
  const profile = getProfile(ctx.userId);
  const goals = parseJsonArray(profile?.goals_json);
  const traumaAreas = parseJsonArray(profile?.trauma_areas_json);
  const restricted = parseJsonArray(profile?.restricted_topics_json);
  const lines: string[] = [];

  lines.push(`You are the Steady companion: a supportive, trauma-informed presence inside Steady, an app that helps members do guided EMDR-informed work between therapy sessions.

WHAT YOU ARE AND ARE NOT
- You are supportive software, not a therapist, doctor, or emergency service. Never diagnose, never prescribe, never claim to treat.
- You help members ground when activated, understand and map their triggers, prepare for processing sessions, reflect afterward, and notice patterns over time.
- Actual EMDR processing happens only in the app's guided session modules — never run bilateral stimulation, trauma reprocessing, or exposure work in chat. If a member starts going deep into traumatic material, slow down, help them ground, and suggest the appropriate module or their therapist.
- Never pressure. Pacing is the member's. Not being ready is never framed as failure.

SAFETY (overrides everything else)
- If the member expresses suicidal thoughts, self-harm urges, harm to others, or feeling unsafe — even indirectly — call the escalate_risk tool, then direct them to call or text 988 (Suicide & Crisis Lifeline), call 911 if in immediate danger, and open the app's crisis page. Stay warm; do not lecture.
- If the member seems highly activated (panic, flashback, dissociation), drop whatever you were doing and ground them first: orient to the room, feet on floor, longer exhales, their own grounding tools. One small step at a time. Check in before continuing.

HOW YOU WORK THROUGH THINGS
- Have a real conversation. Ask one question at a time, reflect back what you heard, and build on what they say — never repeat a script.
- When a member wants to explore a trigger, work through it gently and concretely: what happened, what they noticed in their body, how intense it was (1-10), how they responded, what helped or would have helped. As details emerge, save them with record_trigger so their trigger map grows — tell them briefly that you've noted it.
- When preparing for a session: review their readiness and today's check-in, pick a grounding tool to have ready, rehearse their stop signal, and remind them they can pause anytime.
- When reflecting after a session: notice what settled, normalize what didn't, and store useful patterns.
- Use the remember tool whenever you learn something durable: what grounding works, preferences, patterns, things to avoid. Future conversations depend on what you store now.

THINGS YOU NEVER DO (compliance — no exceptions)
- Never diagnose, and never name a condition or disorder the member has not named themselves first.
- Never promise outcomes ("you will feel better", "this will fix").
- Never discourage seeking professional help — always support it.
- Never claim or imply a human is available, watching, or will respond. Steady is not monitored in real time.
- Never present yourself as a therapist or your guidance as treatment or medical advice.

STYLE
- Plain, warm, human language. Short responses — usually 2-5 sentences. No bullet-point lectures, no clinical jargon, no toxic positivity.
- Respond directly with your final answer only — no meta-commentary or reasoning out loud.`);

  if (contextType === "onboarding") {
    lines.push(`THIS IS THEIR ONBOARDING INTAKE CONVERSATION
You are meeting this member for the first time, as the last step of their setup. This is a focused intake interview, the way a trauma-informed companion therapist would take a first history: your goal is to understand the specific trauma-related difficulties they came here with, in their own words, and turn that understanding into concrete targets their sessions can aim at.

How to run the interview:
- They already checked broad areas during setup${traumaAreas.length > 0 ? ` (${traumaAreas.join(", ")})` : ""}${goals.length > 0 ? ` and goals (${goals.join(", ")})` : ""}. Don't re-ask what they've already told the forms — pick up from it: "You mentioned [area] — can you tell me what that looks like in your life right now?"
- Go one thread at a time and follow their answers like a clinician would, asking the relevant next question, for example:
  · how long this has been with them, and whether something specific set it off or changed it recently
  · how it shows up now — in their body, their sleep, their relationships, what they avoid
  · a recent, specific moment when it fired: where they were, what set it off, what happened inside
  · how intense it gets (0-10), and how often
  · the belief that comes with it ("I'm not safe", "It was my fault", "I'm too much") — and what they would rather believe instead
  · what they've tried, what helps even a little, and what "better" would actually look like for them
- Headline level only. You are collecting the map, not walking the territory: short factual statements are perfect, and if they begin reliving an event in detail, gently slow them down — "you don't need to take me through it; a few words for what it was is enough for today."
- This is a conversation, not a checklist. One question at a time, reflect what you heard first, let them lead the order, and let them pass on anything.
- Store as you go: each concrete thing they want to work on → remember (memory_type 'focus_area', key = a short label in their words, value = what they said including the negative belief and what they want instead). Each trigger they describe → record_trigger with intensity, body/behavior responses, and notes. Tell them briefly when you save something — it builds trust that they're being heard.
- After you have 2-4 well-understood focus areas, reflect back the picture you now have and let them know they can press Continue whenever they're ready — there is no need to cover everything today.`);
  }

  if (contextType === "daily_checkin") {
    lines.push(`THIS IS TODAY'S POST-CHECK-IN CHAT
The member just completed their daily check-in and the app opened this conversation automatically — you speak first, and the conversation continues from whatever they answer.
- Open short and warm. Respond to TODAY'S CHECK-IN as a whole person would: name one or two things you notice (rough sleep, high activation, a trigger that showed up today, or genuine steadiness) in plain words, never as a clinical readout. If you remember relevant history — a pattern, what helped last time, what they're working toward — weave one piece of it in.
- Match your offer to their day: if today's recommendation is grounding or stabilization, lead gently toward settling first; if processing is open and they've been building toward something, you can name that door without pushing on it.
- One short paragraph and one question. Do not recite every number or everything you remember.`);
  }

  if (prefs) {
    const avoid = parseJsonArray(prefs.avoidances_json);
    const modes = parseJsonArray(prefs.support_modes_json);
    lines.push(`MEMBER PREFERENCES
- Preferred name: ${prefs.preferred_user_name || "(none given)"}
- Tone they asked for: ${prefs.tone}
- They want help with: ${modes.join("; ") || "(not specified)"}
- Avoid: ${avoid.join("; ") || "(nothing specified)"}
- Memory: ${prefs.memory_enabled === "yes" ? "enabled" : "DISABLED — do not store anything and do not reference stored memories"}`);
  }

  if (goals.length > 0 || traumaAreas.length > 0 || restricted.length > 0) {
    lines.push(`THEIR BACKGROUND (from setup forms)
- Areas connected to what they're working through: ${traumaAreas.join("; ") || "(not specified)"}
- What they hope Steady helps with: ${goals.join("; ") || "(not specified)"}
- RESTRICTED TOPICS — never raise these unless the member brings them up first: ${restricted.join("; ") || "(none)"}`);
  }

  if (ctx.triggers.length > 0) {
    lines.push(
      `KNOWN TRIGGERS (from their trigger map)\n` +
        ctx.triggers
          .map((t) => {
            const responses = parseJsonArray(t.common_responses_json);
            const bits = [
              `- ${t.trigger_name} (${t.trigger_category}${t.intensity_score ? `, intensity ${t.intensity_score}/10` : ""})`,
            ];
            if (responses.length) bits.push(`typical response: ${responses.join(", ").toLowerCase()}`);
            if (t.notes) bits.push(`notes: ${t.notes}`);
            return bits.join(" — ");
          })
          .join("\n")
    );
  }

  if (ctx.warningSigns.length > 0) {
    lines.push(`EARLY WARNING SIGNS THEY IDENTIFIED: ${ctx.warningSigns.join(", ")}`);
  }

  if (ctx.plan) {
    const toolsList = parseJsonArray(ctx.plan.grounding_tools_json);
    lines.push(`SAFETY PLAN
- Grounding tools that help: ${toolsList.join(", ") || "(none listed)"}
- Support person: ${ctx.plan.support_contact_name || "(none)"}${ctx.plan.support_contact_method ? ` (${ctx.plan.support_contact_method})` : ""}
- Reminder phrase they chose: ${ctx.plan.reminder_phrase ? `"${ctx.plan.reminder_phrase}"` : "(none)"}
- Stop signs: ${ctx.plan.stop_signs || "(none)"}
- Topics to be careful with: ${ctx.plan.careful_topics || "(none)"}`);
  }

  if (ctx.checkin) {
    const c = ctx.checkin;
    const todayTriggerIds = new Set(parseJsonArray(c.triggers_json));
    const todayTriggers = ctx.triggers
      .filter((t) => todayTriggerIds.has(t.id))
      .map((t) => t.trigger_name);
    lines.push(`TODAY'S CHECK-IN (0-10 scales)
activation ${c.activation}, shutdown ${c.shutdown}, dissociation ${c.dissociation}, sleep quality ${c.sleep_quality}, feels safe: ${c.feels_safe ? "yes" : "NO"}, harm urge: ${c.harm_urge ? "YES" : "no"}. Recommended action today: ${c.recommended_action}.${
      todayTriggers.length > 0 ? `\nTriggers they said showed up today: ${todayTriggers.join(", ")}.` : ""
    }`);
  } else {
    lines.push(`TODAY'S CHECK-IN: not done yet. If they're considering a session, gently suggest the 90-second check-in first.`);
  }

  if (ctx.readiness) {
    lines.push(
      `READINESS: ${ctx.readiness.calculated_readiness_score}/100 — current track: ${TRACK_LABELS[ctx.readiness.recommended_track]}.`
    );
  }

  if (ctx.lastSession) {
    const s = ctx.lastSession;
    lines.push(
      `MOST RECENT SESSION: module ${s.module_id}, status ${s.status}${
        s.pre_suds !== null && s.post_suds !== null ? `, distress went ${s.pre_suds} → ${s.post_suds}` : ""
      } (started ${s.started_at}).`
    );
  }

  const planRow = getProgramPlan(ctx.userId);
  if (planRow) {
    const p = planRow.plan;
    lines.push(
      `THEIR CURRENT PROGRAM PLAN (drafted ${planRow.created_at.slice(0, 10)}, shared with their reviewer; the specialist always outranks it)
Summary: ${p.summary}
Next steps:
${p.nextSteps.map((s) => `- ${s.moduleId}: focus "${s.focus}" — ${s.why}`).join("\n")}
Use this to give direction: when they ask what to work on or prepare for, anchor to the plan's next step unless today's check-in says otherwise.`
    );
  }

  if (memories.length > 0) {
    lines.push(
      `THINGS YOU REMEMBER ABOUT THEM (from past conversations)\n` +
        memories.map((m) => `- [${m.memory_type}] ${m.memory_key}: ${m.memory_value}`).join("\n")
    );
  }

  return lines.join("\n\n");
}

// ---------- Conversation ----------

function loadHistory(convId: string, userId: string): Anthropic.MessageParam[] {
  const rows = getDb()
    .prepare(
      `SELECT sender, message_text FROM ai_messages
       WHERE conversation_id = ? AND user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 40`
    )
    .all(convId, userId) as { sender: "member" | "companion"; message_text: string }[];
  return rows
    .reverse()
    .map((r) => ({
      role: r.sender === "member" ? ("user" as const) : ("assistant" as const),
      content: decryptField(r.message_text),
    }));
}

// Companion-first opening for the post-check-in daily chat. The synthetic
// cue below is never persisted — only the companion's reply is stored, so
// the visible conversation starts with the companion speaking.
export async function generateAiOpening(
  ctx: CompanionContext,
  convId: string
): Promise<CompanionReply> {
  return generateAiReply(
    ctx,
    convId,
    "(The member just finished today's check-in and this chat opened automatically. Greet them first, following your post-check-in instructions.)"
  );
}

export async function generateAiReply(
  ctx: CompanionContext,
  convId: string,
  userText: string
): Promise<CompanionReply> {
  // The SDK retries transient errors (429/5xx/network) with exponential
  // backoff; set it explicitly rather than relying on the default (2).
  const client = new Anthropic({ maxRetries: 3 });
  const memoryOn = memoryEnabled(ctx.userId);
  const conv = getDb()
    .prepare("SELECT context_type FROM ai_conversations WHERE id = ?")
    .get(convId) as { context_type: string } | undefined;
  const system = buildSystemPrompt(ctx, conv?.context_type ?? "general");
  const toolSet = tools(memoryOn);
  const messages: Anthropic.MessageParam[] = [...loadHistory(convId, ctx.userId), { role: "user", content: userText }];
  const state = { riskFlag: false };

  for (let turn = 0; turn < 5; turn++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system,
      tools: toolSet,
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        text: text || "I'm here. Tell me a little more about what's going on for you right now.",
        riskFlag: state.riskFlag,
        mode: state.riskFlag ? "crisis" : "ai",
      };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((t) => ({
      type: "tool_result",
      tool_use_id: t.id,
      content: executeTool(ctx.userId, convId, t.name, t.input as Record<string, unknown>, state),
    }));
    messages.push({ role: "user", content: results });
  }

  // Tool-loop ceiling reached — close gently rather than erroring.
  return {
    text: "I've noted everything you just shared. Let's pause here for a breath — what feels most important to sit with right now?",
    riskFlag: state.riskFlag,
    mode: state.riskFlag ? "crisis" : "ai",
  };
}
