import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { hasConsent } from "@/lib/gating";
import { getActiveTriggers, getCompanionPrefs } from "@/lib/profile";
import { getMemoryItems } from "@/lib/companion";
import {
  clearCompanionMemory,
  deleteMemoryItem,
  setMemoryEnabled,
  setTriggerActive,
} from "@/lib/actions";

const TYPE_LABELS: Record<string, string> = {
  trigger: "Triggers",
  grounding_tool: "Grounding tools",
  safety: "Safety",
  readiness: "Readiness",
  tone_preference: "Tone",
  restricted_topic: "Restricted topics",
  session_pattern: "Session patterns",
  progress_pattern: "Progress patterns",
  focus_area: "Focus areas",
};

const SOURCE_LABELS: Record<string, string> = {
  onboarding: "from onboarding",
  daily_checkin: "from a daily check-in",
  session_reflection: "from a session reflection",
  user_message: "from something you told it",
  specialist_note: "from a specialist note",
};

export default async function MemoryControlsPage() {
  const user = await requireMember();
  if (!hasConsent(user.id)) redirect("/onboarding");

  const prefs = getCompanionPrefs(user.id);
  const memoryEnabled = prefs?.memory_enabled ?? "yes";
  const items = getMemoryItems(user.id);
  const triggers = getActiveTriggers(user.id);

  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const list = grouped.get(item.memory_type) ?? [];
    list.push(item);
    grouped.set(item.memory_type, list);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/dashboard" className="text-sm text-olive underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 font-serif text-4xl font-medium">Memory controls</h1>
      <p className="mt-2 text-olive">
        Everything your companion remembers, where it came from, and the controls to change it.
        Deleting here removes it from the companion&apos;s memory.
      </p>

      <form action={setMemoryEnabled} className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
        <h2 className="font-semibold">Companion memory</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["yes", "no", "ask"] as const).map((v) => (
            <label
              key={v}
              className="cursor-pointer rounded-full border border-ground/15 bg-ivory px-5 py-2 text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold"
            >
              <input type="radio" name="memory" value={v} defaultChecked={memoryEnabled === v} className="sr-only" />
              {v === "yes" ? "On" : v === "no" ? "Off" : "Ask me each time"}
            </label>
          ))}
        </div>
        <button className="mt-4 rounded-full border border-ground px-5 py-2 text-sm font-medium transition-colors hover:bg-ground hover:text-ivory">
          Save
        </button>
      </form>

      <section className="mt-8">
        <h2 className="font-serif text-2xl font-medium">Your triggers</h2>
        <p className="mt-1 text-sm text-olive">
          Removing a trigger here also stops the companion and check-in from referencing it.
        </p>
        <div className="mt-3 space-y-2">
          {triggers.length === 0 && <p className="text-sm text-olive">No active triggers.</p>}
          {triggers.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-3xl border border-ground/10 bg-linen p-4 shadow-soft">
              <div>
                <p className="font-medium">{t.trigger_name}</p>
                <p className="text-xs text-olive">
                  {t.trigger_category}
                  {t.intensity_score !== null ? ` · intensity ${t.intensity_score}/10` : ""}
                </p>
              </div>
              <form action={setTriggerActive}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="active" value="0" />
                <button className="rounded-full border border-ground/20 px-4 py-1.5 text-sm text-olive transition-colors hover:bg-moss">
                  Remove
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl font-medium">Remembered items</h2>
        {items.length === 0 && <p className="mt-2 text-sm text-olive">Nothing remembered right now.</p>}
        {[...grouped.entries()].map(([type, list]) => (
          <div key={type} className="mt-5">
            <h3 className="font-semibold">{TYPE_LABELS[type] ?? type}</h3>
            <div className="mt-2 space-y-2">
              {list.map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-3 rounded-3xl border border-ground/10 bg-linen p-4 shadow-soft">
                  <div>
                    <p className="text-sm font-medium">{m.memory_key}</p>
                    <p className="mt-0.5 text-sm text-olive">{m.memory_value}</p>
                    <p className="mt-1 text-xs text-olive/70">
                      {SOURCE_LABELS[m.source_type] ?? m.source_type}
                    </p>
                  </div>
                  <form action={deleteMemoryItem}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="rounded-full border border-ground/20 px-4 py-1.5 text-sm text-olive transition-colors hover:bg-moss">
                      Delete
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {items.length > 0 && (
        <form action={clearCompanionMemory} className="mt-10">
          <button className="w-full rounded-full border border-support/50 px-6 py-3 font-medium text-support transition-colors hover:bg-support/10">
            Delete all companion memory
          </button>
          <p className="mt-2 text-center text-xs text-olive">
            This clears everything above. Your triggers, safety plan, and clinical records are
            kept for your care team unless you remove them too.
          </p>
        </form>
      )}
    </main>
  );
}
