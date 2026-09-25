import { type MemoryType, memoryEnabled } from "./companion";
import { proposeToMember, writeModelMemory } from "./companion-proposals";
import type { GatewayTool } from "./ai-gateway";
import { practiceForMember } from "./practices";

// The companion's tool runtime: what a model may ask to have done, and what
// happens when it asks.
//
// ITS OWN MODULE SO ITS BOUNDARY CAN BE CHECKED. The Expansion Handoff §5.3:
// the Tool Runtime "has no import path to the state writer; enforce with a
// lint rule and a dependency test". A boundary that lives inside a 500-line
// file alongside the prompt builder cannot be tested as a boundary, so the
// executor lives here and tests/companion-boundary.test.ts holds its imports.
//
// NO DATABASE HANDLE, AND THAT IS THE BOUNDARY. This module imports neither
// `data` nor `db`. Everything it writes goes through `proposeToMember` or
// `writeModelMemory`, both of which refuse to write anything a session reads.
// With a raw handle in reach the rule would be a convention; without one it is
// a missing import path, which is what §5.3 asks for.

// ---------- Tools the companion can use to persist what it learns ----------

const TRIGGER_CATEGORIES = ["relational", "environmental", "body", "memory", "internal", "other"];

export function companionTools(memoryOn: boolean): GatewayTool[] {
  const list: GatewayTool[] = [
    {
      name: "record_trigger",
      // STILL write-soft, and now truly so: it writes a suggestion the person
      // can dismiss, which is patient-owned and reversible. It used to write
      // their trigger map, intensity included, which was neither.
      tier: "write-soft",
      capability: "suggest_patient_trigger",
      description:
        "Suggest a trigger for the member to add to their trigger map. Call this when the member describes something that sets them off in enough detail to name. This does NOT add it to their map: the member sees your suggestion, decides whether to add it, and rates how intense it is themselves. Never tell them it has been saved. Say you have noted it for them to look at, and that they can add it and rate it in Memory controls if they want to. Use the member's own words where possible.",
      inputSchema: {
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
          // NO intensity_score. It is the number that decides whether a
          // trigger may be processed without a specialist, so it is not a
          // field a model is invited to fill in.
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
      tier: "write-soft",
      capability: "store_patient_memory",
      description:
        "Store a durable fact about the member so future conversations can build on it. Call this when the member shares something worth carrying forward: a grounding tool that works or doesn't, a preference about how to be spoken to, a pattern you notice across sessions or check-ins, a topic to avoid, or progress worth celebrating later. Use memory_type 'focus_area' when the member names something they specifically want to work on — those are offered back as focus choices before their therapy sessions. Use 'grounding_tool' with key 'calm place' for their calm-place image. Do not store crisis content or anything the member asked you to forget.",
      inputSchema: {
        type: "object",
        properties: {
          memory_type: {
            type: "string",
            // "safety" is deliberately absent (audit): SafetyAudit-class
            // memory is never model-writable or model-readable — safety
            // events flow through the audit log, not companion memory.
            enum: [
              "trigger",
              "grounding_tool",
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
  // Handoff 10 §3.5 (row CV10_A16): the companion may SUGGEST a practice or a
  // skill. It cannot enrol, complete or write anything — this tool reads, and
  // what it reads goes through the same sign-off and gate as the member's own
  // list, so it cannot surface something the member could not open.
  list.push({
    name: "suggest_practice",
    tier: "read",
    capability: "suggest_practice",
    description:
      "Suggest one practice or skill the member can open now, by its id. Returns its name and link if it is open to them today, or says it is not — in which case do not mention it. It does not start anything and records nothing.",
    inputSchema: {
      type: "object",
      properties: { practice_id: { type: "string", description: "The practice or skill id, e.g. 'skill-orient-room'" } },
      required: ["practice_id"],
    },
  });
  list.push({
    name: "escalate_risk",
    // Its own tier. This only ever RAISES protection — it opens an alert to the
    // care team and can close nothing — so it must not wait for the human
    // confirmation write-clinical requires. Waiting is the harm here.
    tier: "safety-escalation",
    capability: "notify_care_team",
    description:
      "Call this if the member expresses suicidal thoughts, intent to harm themselves or others, or says they are not safe — even indirectly. This notifies their care team. After calling it, your reply must direct them to call or text 988, call 911 if in immediate danger, and use the in-app crisis page.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief description of the risk language, for the care team" },
      },
      required: ["reason"],
    },
  });
  return list;
}

export async function executeCompanionTool(
  userId: string,
  convId: string,
  name: string,
  input: Record<string, unknown>,
  state: { riskFlag: boolean }
): Promise<string> {
  if (name === "suggest_practice") {
    const id = String(input.practice_id ?? "").trim().slice(0, 80);
    const found = await practiceForMember(userId, id);
    if (found.state !== "open") return "Not available to this member today. Do not suggest it.";
    const href = found.practice.type === "skill" ? `/app/activities/skills/${found.practice.id}` : `/app/activities`;
    return `Open to them: "${found.practice.title}" (${href}). Offer it as a suggestion they can take or leave.`;
  }
  if (name === "record_trigger") {
    const triggerName = String(input.trigger_name ?? "").trim().slice(0, 100);
    if (!triggerName) return "Ignored: trigger_name is required.";
    const category = TRIGGER_CATEGORIES.includes(String(input.trigger_category))
      ? String(input.trigger_category)
      : "other";
    const responses = Array.isArray(input.common_responses)
      ? (input.common_responses as unknown[]).map(String).slice(0, 12)
      : [];
    const notes = input.notes ? String(input.notes).slice(0, 2000) : "";
    // ANY intensity_score IN THE INPUT IS IGNORED, NOT CLAMPED. Clamping would
    // still be the model choosing the number.
    await proposeToMember({
      userId,
      kind: "trigger",
      title: triggerName,
      category,
      detail: [notes, responses.length ? `Usually: ${responses.join(", ")}.` : ""]
        .filter(Boolean).join("\n\n") || null,
      conversationId: convId,
    });
    return `Noted "${triggerName}" as a suggestion. It is not on their trigger map until they add it and rate it themselves.`;
  }
  if (name === "remember") {
    if (!(await memoryEnabled(userId))) return "Memory is turned off for this member; nothing stored.";
    const key = String(input.key ?? "").trim().slice(0, 120);
    const value = String(input.value ?? "").trim().slice(0, 1000);
    if (!key || !value) return "Ignored: key and value are required.";
    // A FOCUS AREA IS A PROPOSAL, because it is offered back as something to
    // work on in a processing session. Everything else — tone, topics to avoid,
    // what grounds them — is the companion's own notes and is written as before,
    // through the writer that refuses session targets.
    if (input.memory_type === "focus_area") {
      await proposeToMember({ userId, kind: "focus_area", title: key, detail: value, conversationId: convId });
      return `Noted "${key}" as a possible focus for them to confirm. It is not offered in their sessions until they do.`;
    }
    await writeModelMemory({
      userId,
      type: input.memory_type as MemoryType,
      key,
      value,
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
