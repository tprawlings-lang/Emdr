// Mobile in-session live-voice service. Mirrors speakInSession /
// grantVoiceConsent / withdrawVoiceConsent in lib/actions.ts. On mobile, speech
// is transcribed ON DEVICE (Apple Speech framework) — only the resulting TEXT
// reaches the server, matching the voice-consent copy. The server then produces
// a deterministic, guarded response (optionally reworded by the model only when
// the line is already safe), never touching the session's stop rules.

import { data } from "../data";
import { newId, tenantForUser } from "../db";
import { audit } from "../audit";
import { rateLimit } from "../rate-limit";
import { hasVoiceConsent, liveAvailableFor } from "../gating";
import { VOICE_CONSENT_SECTIONS, VOICE_CONSENT_VERSION } from "../policy";
import { decideAccess } from "../safety/decide";
import { memoryEnabled, getModelExposableMemoryItems } from "../companion";
import { selectTechniques } from "../therapy-kb/select";
import { composeSessionResponse, rephraseSessionLine, type SessionResponse } from "../session-companion";
import { validateCompanionOutput, SAFE_FALLBACK } from "../safety/companion-guard";
import { grantConsent, withdrawConsent } from "../spine";

// ---------- consent + availability ----------

export async function voiceInfo(userId: string) {
  const [granted, available] = await Promise.all([
    hasVoiceConsent(userId),
    liveAvailableFor(userId),
  ]);
  return {
    version: VOICE_CONSENT_VERSION,
    sections: VOICE_CONSENT_SECTIONS,
    granted,
    available,
  };
}

export async function grantVoice(userId: string) {
  const c = await data();
  const active = await c.get(
    "SELECT id FROM consents WHERE user_id = ? AND scope = 'voice_biometric' AND revoked_at IS NULL LIMIT 1",
    [userId]
  );
  if (!active) {
    await grantConsent({ userId, policyVersion: VOICE_CONSENT_VERSION, scope: "voice_biometric" });
    await audit({ actorId: userId, actorRole: "member", family: "consent", type: "voice_consent_granted", detail: { policy_version: VOICE_CONSENT_VERSION, scope: "voice_biometric", via: "mobile" } });
  }
  return voiceInfo(userId);
}

export async function withdrawVoice(userId: string) {
  const c = await data();
  await withdrawConsent({ userId, scope: "voice_biometric" });
  await audit({ actorId: userId, actorRole: "member", family: "consent", type: "voice_consent_withdrawn", detail: { scope: "voice_biometric", via: "mobile" } });
  return voiceInfo(userId);
}

// ---------- the spoken responder ----------

export async function speakInSession(userId: string, args: {
  sessionId: string; moduleId: string; transcript: string;
  currentSuds: number | null; calmPlace: string | null; name: string | null;
}): Promise<{ ok: boolean; error?: string; response?: SessionResponse }> {
  if (!(await liveAvailableFor(userId))) return { ok: false, error: "Live voice isn't enabled on this account." };

  const c = await data();
  const owned = await c.get("SELECT id FROM therapy_sessions WHERE id = ? AND user_id = ?", [args.sessionId, userId]);
  if (!owned) return { ok: false, error: "Session not found." };

  const transcript = String(args.transcript ?? "").trim().slice(0, 1000);
  if (!transcript) return { ok: false, error: "Nothing to respond to." };
  if (!rateLimit(`session-speak:${userId}`, 30, 60_000).ok) {
    return { ok: false, error: "Let's take that a little slower." };
  }

  let tier;
  try { tier = (await decideAccess(userId, Date.now())).tier; }
  catch { return { ok: false, error: "Unavailable right now." }; }

  const memories = (await memoryEnabled(userId)) ? await getModelExposableMemoryItems(userId) : [];
  const signalText = [transcript, ...memories.map((m) => `${m.memory_key} ${m.memory_value}`)].join(" ");
  const techniques = selectTechniques({ tier, activation: args.currentSuds, dissociation: null, text: signalText, limit: 1 });

  const base = composeSessionResponse({
    transcript, currentSuds: args.currentSuds, tier, techniques,
    calmPlace: args.calmPlace, name: args.name,
  });
  // The optional warmth pass, through the gateway and shared with the web path.
  // Both used to carry their own copy of this call.
  let response = await rephraseSessionLine({
    base, transcript, calmPlace: args.calmPlace, userId, tenantId: tenantForUser(userId),
  });
  if (!validateCompanionOutput(response.text).ok) {
    response = { ...response, text: SAFE_FALLBACK, source: "deterministic" };
  }

  await audit({
    actorId: userId, actorRole: "member", family: "module_runtime", type: "session_spoken_response",
    target: args.moduleId, detail: { kind: response.kind, crisis: response.crisis, source: response.source, suggestGroundMe: response.suggestGroundMe, via: "mobile" },
  });
  return { ok: true, response };
}
