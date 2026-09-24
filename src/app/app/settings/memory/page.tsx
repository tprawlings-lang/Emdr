import { MemberPage } from "@/components/member/MemberPage";
import { requireMember } from "@/lib/auth";
import { getActiveTriggers, getCompanionPrefs } from "@/lib/profile";
import { getMemoryItems } from "@/lib/companion";
import {
  clearCompanionMemory,
  deleteMemoryItem,
  setMemoryEnabled,
  setTriggerActive,
  rateTrigger,
  decideCompanionProposal,
} from "@/lib/actions";
import { pendingProposals } from "@/lib/companion-proposals";
import { SubmitButton } from "@/components/experience/SubmitButton";

/** 1–10, lowest first. NO DEFAULT is selected anywhere this is used: a
 *  pre-selected intensity is a decision the person did not make. */
const INTENSITIES = Array.from({ length: 10 }, (_, i) => i + 1);

function IntensityPicker({ id }: { id: string }) {
  return (
    <label className="text-sm">
      <span className="mr-2 text-olive">How intense is it for you?</span>
      <select
        id={id}
        name="intensity"
        required
        defaultValue=""
        className="rounded-xl border border-ground/20 bg-app-surface px-3 py-1.5 text-sm"
      >
        <option value="" disabled>Choose 1–10</option>
        {INTENSITIES.map((n) => (
          <option key={n} value={n}>
            {n}{n === 1 ? " — mild" : n === 10 ? " — overwhelming" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

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

export default async function MemoryControlsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireMember();
  const { error } = await searchParams;
  const suggestions = await pendingProposals(user.id);

  const prefs = await getCompanionPrefs(user.id);
  const memoryEnabled = prefs?.memory_enabled ?? "yes";
  const items = await getMemoryItems(user.id);
  const triggers = await getActiveTriggers(user.id);

  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    const list = grouped.get(item.memory_type) ?? [];
    list.push(item);
    grouped.set(item.memory_type, list);
  }

  return (
    <MemberPage
      layer="evidence"
      title="Memory controls"
      lede="Everything your companion remembers, where it came from, and the controls to change it. Deleting here removes it from the companion&apos;s memory."
    >

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

      {error && (
        <p role="alert" className="measure mt-6 rounded-2xl border border-state-caution/40 bg-state-caution-bg px-4 py-3 text-sm text-ground">
          {error}
        </p>
      )}

      {/* WHAT THE COMPANION NOTICED, WAITING FOR THE PERSON. Nothing here is on
          their trigger map or offered in a session until they add it — and a
          trigger is added with the intensity THEY give it, because that number
          decides whether it can be worked on without a specialist. */}
      {suggestions.length > 0 && (
        <section id="suggestions" aria-labelledby="suggestions-h" className="mt-8">
          <h2 id="suggestions-h" className="type-display text-2xl font-medium">
            Your companion noticed
          </h2>
          <p className="measure mt-1 text-sm text-olive">
            Things that came up in conversation. None of them are part of your map or your
            sessions unless you add them. Leaving them is fine.
          </p>
          <ul className="mt-3 space-y-3">
            {suggestions.map((p) => (
              <li key={p.id} className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
                <p className="font-medium">{p.title}</p>
                <p className="text-xs text-olive">
                  {p.kind === "trigger" ? `A possible trigger${p.category ? ` · ${p.category}` : ""}` : "A possible focus"}
                </p>
                {p.detail && <p className="measure mt-2 whitespace-pre-line text-sm text-ground/90">{p.detail}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <form action={decideCompanionProposal} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="proposalId" value={p.id} />
                    {p.kind === "trigger" ? (
                      <>
                        <input type="hidden" name="decision" value="accept_trigger" />
                        <IntensityPicker id={`intensity-${p.id}`} />
                        <SubmitButton
                          pendingLabel="Adding…"
                          className="rounded-full bg-app-ink px-4 py-1.5 text-sm font-medium text-app-surface"
                        >
                          Add to my map
                        </SubmitButton>
                      </>
                    ) : (
                      <>
                        <input type="hidden" name="decision" value="accept_focus" />
                        <SubmitButton
                          pendingLabel="Adding…"
                          className="rounded-full bg-app-ink px-4 py-1.5 text-sm font-medium text-app-surface"
                        >
                          Add as something to work on
                        </SubmitButton>
                      </>
                    )}
                  </form>
                  <form action={decideCompanionProposal}>
                    <input type="hidden" name="proposalId" value={p.id} />
                    <input type="hidden" name="decision" value="dismiss" />
                    <SubmitButton
                      pendingLabel="Clearing…"
                      className="rounded-full border border-ground/20 px-4 py-1.5 text-sm text-olive"
                    >
                      Not now
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section id="triggers" className="mt-8">
        <h2 className="type-display text-2xl font-medium">Your triggers</h2>
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
                  {t.intensity_score !== null ? ` · intensity ${t.intensity_score}/10` : " · not rated yet"}
                </p>
                {/* AN UNRATED TRIGGER CANNOT BE WORKED ON ALONE, and this is where
                    the session picker sends them to change that. */}
                {t.intensity_score === null && (
                  <form action={rateTrigger} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <IntensityPicker id={`rate-${t.id}`} />
                    <SubmitButton
                      pendingLabel="Saving…"
                      className="rounded-full border border-ground/25 px-3.5 py-1.5 text-sm text-ground"
                    >
                      Save rating
                    </SubmitButton>
                  </form>
                )}
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
        <h2 className="type-display text-2xl font-medium">Remembered items</h2>
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
                    <p className="mt-1 text-xs text-olive">
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
          <button className="w-full rounded-full border border-ground/30 px-6 py-3 font-medium text-ground transition-colors hover:bg-ground/10">
            Delete all companion memory
          </button>
          <p className="mt-2 text-center text-xs text-olive">
            This clears everything above. Your triggers, safety plan, and clinical records are
            kept for your care team unless you remove them too.
          </p>
        </form>
      )}
    </MemberPage>
  );
}
