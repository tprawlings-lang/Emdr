import { getMemoryItemsByType } from "./companion";
import { getActiveTriggers, getSafetyPlan } from "./profile";
import { getProgramPlan } from "./program-plan";

// Pre-session focus selection. Before an EMDR module starts, the member is
// offered everything Steady already knows that the module can work with —
// triggers from their map, their saved calm place, resources and grounding
// tools, and the focus areas they named to the companion — so each session
// begins with an explicit, chosen direction. Selecting a focus is always
// optional, and triggers too intense for self-guided work are shown but
// not selectable.

// Triggers at or above this intensity stay specialist-territory for the
// self-guided trigger modules (feature spec: "low- to medium-intensity").
const SELF_GUIDED_INTENSITY_CAP = 7;

export interface FocusOption {
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SessionFocus {
  /** Question shown above the options, e.g. "What will today's focus be?" */
  prompt: string;
  helper?: string;
  options: FocusOption[];
  customPlaceholder: string;
}

function parseJsonArray(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function triggerOptions(userId: string, opts: { capIntensity?: boolean } = {}): FocusOption[] {
  return getActiveTriggers(userId)
    .sort((a, b) => (a.intensity_score ?? 11) - (b.intensity_score ?? 11))
    .map((t) => {
      const tooIntense =
        opts.capIntensity === true &&
        t.intensity_score !== null &&
        t.intensity_score >= SELF_GUIDED_INTENSITY_CAP;
      return {
        id: `trigger:${t.id}`,
        label: t.trigger_name,
        detail: `${t.trigger_category}${t.intensity_score !== null ? ` · intensity ${t.intensity_score}/10` : ""}`,
        disabled: tooIntense,
        disabledReason: tooIntense
          ? "Too intense for self-guided work — bring this one to your specialist"
          : undefined,
      };
    });
}

function focusAreaOptions(userId: string): FocusOption[] {
  return getMemoryItemsByType(userId, "focus_area").map((m) => ({
    id: `focus:${m.id}`,
    label: m.memory_key,
    detail: m.memory_value,
  }));
}

export function getSavedCalmPlace(userId: string): string | null {
  const item = getMemoryItemsByType(userId, "grounding_tool").find((m) =>
    /calm place/i.test(m.memory_key)
  );
  return item ? item.memory_value : null;
}

// The program plan's recommendation for this module, surfaced as the first
// focus option so Module 5's mapping work directly steers later sessions.
async function planOption(userId: string, moduleId: string): Promise<FocusOption | null> {
  const row = await getProgramPlan(userId);
  const step = row?.plan.nextSteps.find((s) => s.moduleId === moduleId);
  if (!step) return null;
  return {
    id: `plan:${moduleId}`,
    label: step.focus,
    detail: `Recommended in your program plan — ${step.why}`,
  };
}

async function withPlanFirst(userId: string, moduleId: string, options: FocusOption[]): Promise<FocusOption[]> {
  const rec = await planOption(userId, moduleId);
  if (!rec) return options;
  const rest = options.filter(
    (o) => o.label.toLowerCase() !== rec.label.toLowerCase() || o.disabled
  );
  return [rec, ...rest];
}

export async function getSessionFocus(userId: string, moduleId: string): Promise<SessionFocus | null> {
  switch (moduleId) {
    case "calm-place": {
      const saved = getSavedCalmPlace(userId);
      return {
        prompt: "Where is your calm place today?",
        helper: saved
          ? "You can return to the place you saved before, or choose a new one."
          : "Name the place in a word or two — it gets saved so Steady can bring you back to it.",
        options: saved
          ? [{ id: "calm:saved", label: saved, detail: "Your saved calm place" }]
          : [],
        customPlaceholder: "e.g. shore, pines, grandma's kitchen",
      };
    }
    case "resourcing": {
      const remembered = getMemoryItemsByType(userId, "grounding_tool").filter(
        (m) => !/calm place/i.test(m.memory_key)
      );
      const seen = new Set(remembered.map((m) => m.memory_key.toLowerCase()));
      const tools = parseJsonArray(getSafetyPlan(userId)?.grounding_tools_json).filter(
        (t) => !seen.has(t.toLowerCase())
      );
      return {
        prompt: "Which resource would you like to strengthen today?",
        helper: "A memory of coping well, a person or figure who steadies you, or a tool that already helps.",
        options: [
          ...remembered.map((m) => ({
            id: `mem:${m.id}`,
            label: m.memory_key,
            detail: m.memory_value,
          })),
          ...tools.map((t) => ({ id: `tool:${t}`, label: t, detail: "From your safety plan" })),
        ],
        customPlaceholder: "e.g. the day I handled the move, my grandfather's voice",
      };
    }
    case "recent-trigger":
      return {
        prompt: "Which trigger from your map do you want to work on today?",
        helper: "Choose one recent, low-to-medium trigger — not a core memory.",
        options: await withPlanFirst(userId, moduleId, triggerOptions(userId, { capIntensity: true })),
        customPlaceholder: "A recent trigger that isn't on your map yet",
      };
    case "safe-target":
      return {
        prompt: "Which target are you working on today?",
        helper: "Choose the target your specialist approved with you.",
        options: await withPlanFirst(userId, moduleId, [
          ...triggerOptions(userId),
          ...focusAreaOptions(userId),
        ]),
        customPlaceholder: "Name the approved target in a few words",
      };
    case "installation":
      return {
        prompt: "Which processed target are you reinforcing?",
        helper: "Pick the target whose distress already came down in earlier work.",
        options: await withPlanFirst(userId, moduleId, triggerOptions(userId)),
        customPlaceholder: "Name the processed target",
      };
    case "future-template":
      return {
        prompt: "Which upcoming situation do you want to rehearse?",
        helper: "Something you expect to be hard — rehearse yourself coping with it.",
        options: await withPlanFirst(userId, moduleId, focusAreaOptions(userId)),
        customPlaceholder: "e.g. the custody hearing next month, visiting my parents",
      };
    case "relational":
      return {
        prompt: "What would you like today's focus to be?",
        options: focusAreaOptions(userId),
        customPlaceholder: "e.g. the way I talk to myself after mistakes",
      };
    default:
      // Skill-building and review modules (containment, body-scan,
      // trigger-map, maintenance) define their own content.
      return null;
  }
}
