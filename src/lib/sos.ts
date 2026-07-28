// SOS panic panel (roadmap F7). A member can, from anywhere, reach immediate
// relief in one tap: a paced grounding breath, their own calm place, a
// one-tap call to the safe person they named, and the crisis line. This is
// member-initiated relief — distinct from /crisis, which is the escalation
// the safety gate forces. Opening it is recorded as a coded safety event so
// the specialist (and the engine) can see that the member reached for help,
// without storing any of what they were feeling.

import { audit } from "./audit";
import { getSafetyPlan } from "./profile";
import { getSavedCalmPlace } from "./session-focus";
import { CRISIS_REGIONS } from "./crisis-resources";

export interface SosPanel {
  /** The member's saved calm place description, if any. */
  calmPlace: string | null;
  /** A short phrase the member asked us to remind them of. */
  reminderPhrase: string | null;
  /** Grounding tools the member said have helped before. */
  groundingTools: string[];
  /** The safe person the member named, and how to reach them. */
  supportContactName: string | null;
  supportContactMethod: string | null;
  /** Default (US) crisis line for the one-tap button. */
  crisisLabel: string;
  crisisHref: string;
}

/** Everything the panic panel needs, assembled from the member's own plan. */
export async function getSosPanel(userId: string): Promise<SosPanel> {
  const [plan, calmPlace] = await Promise.all([
    getSafetyPlan(userId),
    getSavedCalmPlace(userId),
  ]);
  let groundingTools: string[] = [];
  if (plan?.grounding_tools_json) {
    try {
      const parsed = JSON.parse(plan.grounding_tools_json);
      if (Array.isArray(parsed)) groundingTools = parsed.filter((t) => typeof t === "string");
    } catch {
      groundingTools = [];
    }
  }
  const us = CRISIS_REGIONS[0].resources[0];
  return {
    calmPlace,
    reminderPhrase: plan?.reminder_phrase ?? null,
    groundingTools,
    supportContactName: plan?.support_contact_name ?? null,
    supportContactMethod: plan?.support_contact_method ?? null,
    crisisLabel: us.label,
    crisisHref: us.href,
  };
}

/** Record that the member opened the panic panel. Types and ids only — never
 *  what prompted it (compliance 4B.4). */
export async function recordSosOpened(userId: string): Promise<{ ok: true }> {
  await audit({
    actorId: userId,
    actorRole: "member",
    family: "safety",
    type: "sos_opened",
  });
  return { ok: true };
}
