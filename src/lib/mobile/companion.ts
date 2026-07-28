// Mobile AI-companion service. Mirrors sendCompanionMessage /
// startDailyCompanionChat in lib/actions.ts 1:1 and reuses the same crisis
// detection, AI-or-rules fallback, rate limiting, and encrypted storage. The
// Anthropic key never leaves the server — the app only sends/receives text.

import { data } from "../data";
import { newId } from "../db";
import { encryptField, decryptField } from "../crypto";
import { audit } from "../audit";
import {
  buildCompanionContext, detectRisk, generateReply, generateCheckinOpening,
  getMemoryItems,
} from "../companion";
import { aiCompanionEnabled, generateAiOpening, generateAiReply } from "../companion-ai";
import { rateLimit } from "../rate-limit";

const COMPANION_MSG_LIMIT = Number(process.env.EMDR_COMPANION_RATE_LIMIT ?? 20);
const COMPANION_WINDOW_MS = 60_000;

async function createAlert(userId: string, type: string, severity: "urgent" | "high" | "moderate" | "info", detail: string) {
  const c = await data();
  await c.run("INSERT INTO alerts (id, user_id, alert_type, severity, detail) VALUES (?, ?, ?, ?, ?)",
    [newId(), userId, type, severity, detail]);
}

export interface ChatMessage { sender: "member" | "companion"; text: string; riskFlag: boolean }

// ---------- daily post-check-in chat (idempotent per day) ----------

export async function openDailyChat(userId: string): Promise<{ conversationId: string; messages: ChatMessage[] }> {
  const c = await data();
  const existing = (await c.get(
    `SELECT id FROM ai_conversations WHERE user_id = ? AND context_type = 'daily_checkin'
       AND date(started_at) = date('now') ORDER BY started_at DESC LIMIT 1`, [userId]
  )) as { id: string } | undefined;

  if (existing) {
    const rows = (await c.all(
      `SELECT sender, message_text, risk_flag FROM ai_messages WHERE conversation_id = ? ORDER BY created_at, rowid`,
      [existing.id]
    )) as { sender: "member" | "companion"; message_text: string; risk_flag: number }[];
    if (rows.length > 0) {
      return { conversationId: existing.id, messages: rows.map((m) => ({ sender: m.sender, text: decryptField(m.message_text), riskFlag: m.risk_flag === 1 })) };
    }
  }

  const convId = existing?.id ?? newId();
  if (!existing) {
    await c.run("INSERT INTO ai_conversations (id, user_id, context_type) VALUES (?, ?, 'daily_checkin')", [convId, userId]);
  }
  const ctx = await buildCompanionContext(userId);
  let opening;
  if (!aiCompanionEnabled()) {
    opening = generateCheckinOpening(ctx);
  } else {
    try { opening = await generateAiOpening(ctx, convId); }
    catch (err) { console.error("Companion AI opening failed; fallback:", err); opening = generateCheckinOpening(ctx); }
  }
  await c.run("INSERT INTO ai_messages (id, conversation_id, user_id, sender, message_text, risk_flag) VALUES (?, ?, ?, 'companion', ?, ?)",
    [newId(), convId, userId, encryptField(opening.text), opening.riskFlag ? 1 : 0]);
  if (opening.riskFlag) {
    await c.run("UPDATE ai_conversations SET risk_level = 'urgent' WHERE id = ?", [convId]);
    await createAlert(userId, "companion_risk_language", "urgent", "Risk surfaced while opening the post-check-in companion chat (mobile).");
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "companion_daily_chat_opened", target: convId, detail: { mode: opening.mode, riskFlag: opening.riskFlag, via: "mobile" } });
  return { conversationId: convId, messages: [{ sender: "companion", text: opening.text, riskFlag: opening.riskFlag }] };
}

// ---------- send a message ----------

export async function sendMessage(
  userId: string, conversationId: string | null, text: string, contextType?: string
): Promise<{ conversationId: string; reply: string; riskFlag: boolean; aiEnabled: boolean }> {
  const trimmed = text.trim().slice(0, 2000);
  const c = await data();
  const context = ["general", "onboarding"].includes(contextType ?? "") ? (contextType as string) : "general";

  let convId = conversationId;
  if (convId) {
    const owned = await c.get("SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?", [convId, userId]);
    if (!owned) convId = null;
  }
  if (!convId) {
    convId = newId();
    await c.run("INSERT INTO ai_conversations (id, user_id, context_type) VALUES (?, ?, ?)", [convId, userId, context]);
  }

  const ctx = await buildCompanionContext(userId);
  const isCrisis = detectRisk(trimmed);
  let reply;
  if (isCrisis || !aiCompanionEnabled()) {
    reply = generateReply(ctx, trimmed);
  } else if (!rateLimit(`companion:${userId}`, COMPANION_MSG_LIMIT, COMPANION_WINDOW_MS).ok) {
    reply = { text: "Let's take this a little slower — I'm still here. Give it a moment and send that again in a minute.", riskFlag: false, mode: "general" as const };
  } else {
    try { reply = await generateAiReply(ctx, convId, trimmed); }
    catch (err) { console.error("Companion AI call failed; fallback:", err); reply = generateReply(ctx, trimmed); }
  }

  const insertMsg = "INSERT INTO ai_messages (id, conversation_id, user_id, sender, message_text, risk_flag) VALUES (?, ?, ?, ?, ?, ?)";
  await c.run(insertMsg, [newId(), convId, userId, "member", encryptField(trimmed), reply.riskFlag ? 1 : 0]);
  await c.run(insertMsg, [newId(), convId, userId, "companion", encryptField(reply.text), reply.riskFlag ? 1 : 0]);

  if (reply.riskFlag) {
    await c.run("UPDATE ai_conversations SET risk_level = 'urgent' WHERE id = ?", [convId]);
    await createAlert(userId, "companion_risk_language", "urgent", "Risk language detected in a companion conversation (mobile). Routed to crisis resources.");
  }
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "companion_message", target: convId, detail: { mode: reply.mode, riskFlag: reply.riskFlag, via: "mobile" } });
  return { conversationId: convId, reply: reply.text, riskFlag: reply.riskFlag, aiEnabled: aiCompanionEnabled() };
}

// ---------- conversation history ----------

export async function getConversation(userId: string, conversationId: string): Promise<ChatMessage[]> {
  const c = await data();
  const owned = await c.get("SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?", [conversationId, userId]);
  if (!owned) return [];
  const rows = (await c.all(
    "SELECT sender, message_text, risk_flag FROM ai_messages WHERE conversation_id = ? ORDER BY created_at, rowid",
    [conversationId]
  )) as { sender: "member" | "companion"; message_text: string; risk_flag: number }[];
  return rows.map((m) => ({ sender: m.sender, text: decryptField(m.message_text), riskFlag: m.risk_flag === 1 }));
}

/** The most recent general conversation (so the companion tab resumes). */
export async function latestGeneralConversation(userId: string): Promise<{ conversationId: string; messages: ChatMessage[] } | null> {
  const c = await data();
  const row = (await c.get(
    "SELECT id FROM ai_conversations WHERE user_id = ? AND context_type = 'general' ORDER BY started_at DESC LIMIT 1",
    [userId]
  )) as { id: string } | undefined;
  if (!row) return null;
  return { conversationId: row.id, messages: await getConversation(userId, row.id) };
}

// ---------- memory controls ----------

export async function listMemory(userId: string): Promise<{ enabled: string; items: { id: string; type: string; key: string; value: string }[] }> {
  const c = await data();
  const pref = (await c.get("SELECT memory_enabled FROM ai_companion_preferences WHERE user_id = ?", [userId])) as { memory_enabled: string } | undefined;
  const items = (await getMemoryItems(userId)).map((m) => ({ id: m.id, type: m.memory_type, key: m.memory_key, value: m.memory_value }));
  return { enabled: pref?.memory_enabled ?? "yes", items };
}

export async function setMemoryEnabled(userId: string, value: string) {
  const v = ["yes", "no", "ask"].includes(value) ? value : "yes";
  const c = await data();
  await c.run(
    `INSERT INTO ai_companion_preferences (user_id, memory_enabled) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET memory_enabled = excluded.memory_enabled, updated_at = CURRENT_TIMESTAMP`,
    [userId, v]
  );
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "companion_memory_setting", detail: { value: v, via: "mobile" } });
}

export async function deleteMemory(userId: string, id: string) {
  const c = await data();
  await c.run("UPDATE ai_memory_items SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?", [id, userId]);
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "companion_memory_deleted", target: id, detail: { via: "mobile" } });
}

export async function clearMemory(userId: string) {
  const c = await data();
  await c.run("UPDATE ai_memory_items SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
  await audit({ actorId: userId, actorRole: "member", family: "clinical", type: "companion_memory_cleared", detail: { via: "mobile" } });
}
