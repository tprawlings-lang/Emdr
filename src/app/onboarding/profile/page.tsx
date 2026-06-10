import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { hasConsent, screeningComplete } from "@/lib/gating";
import { subscriptionActive } from "@/lib/billing";
import {
  COMPANION_AVOIDANCES,
  COMPANION_SUPPORT_MODES,
  COMPANION_TONES,
  GOALS,
  GROUNDING_TOOLS,
  TRACK_GUIDANCE,
  TRACK_LABELS,
  TRAUMA_AREAS,
  TRIGGER_CATALOG,
  TRIGGER_RESPONSES,
  WARNING_SIGNS,
  getActiveTriggers,
  getCompanionPrefs,
  getLatestReadiness,
  getProfile,
  getSafetyPlan,
  getWarningSigns,
  profileComplete,
} from "@/lib/profile";
import {
  completeOnboardingProfile,
  saveCompanionPrefs,
  saveReadinessAssessment,
  saveSafetyPlan,
  saveSupportStatus,
  saveTraumaContext,
  saveTriggerDetails,
  saveTriggers,
  saveWarningSigns,
} from "@/lib/actions";
import { getMemoryItemsByType, hasOnboardingConversation } from "@/lib/companion";
import CompanionChat from "@/components/CompanionChat";

const STEPS = [
  "welcome",
  "support",
  "background",
  "triggers",
  "trigger-details",
  "warning-signs",
  "readiness",
  "safety-plan",
  "companion",
  "focus-chat",
  "summary",
] as const;
type Step = (typeof STEPS)[number];

// Pill-style checkbox/radio used across all steps: one tap, no dense forms.
function Pill({
  type,
  name,
  value,
  label,
  defaultChecked,
  required,
}: {
  type: "checkbox" | "radio";
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
  required?: boolean;
}) {
  return (
    <label className="cursor-pointer rounded-full border border-ground/15 bg-linen px-4 py-2 text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold">
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        required={required}
        className="sr-only"
      />
      {label}
    </label>
  );
}

function ScaleRow({ name, low, high }: { name: string; low: string; high: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, v) => (
          <label
            key={v}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-ground/15 bg-linen text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold"
          >
            <input type="radio" name={name} value={v} required className="sr-only" />
            {v}
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-olive">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function NextButton({ label = "Continue" }: { label?: string }) {
  return (
    <button
      type="submit"
      className="mt-8 w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
    >
      {label}
    </button>
  );
}

export default async function ProfileOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const user = await requireMember();
  if (!subscriptionActive(user.id)) redirect("/subscribe");
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");
  if (profileComplete(user.id)) redirect("/dashboard");

  const { step: stepParam } = await searchParams;
  const profile = getProfile(user.id);
  const triggers = getActiveTriggers(user.id);
  const signs = getWarningSigns(user.id);
  const readiness = getLatestReadiness(user.id);
  const plan = getSafetyPlan(user.id);
  const prefs = getCompanionPrefs(user.id);
  const focusAreas = getMemoryItemsByType(user.id, "focus_area");

  // Resume where the member left off unless a step is explicitly requested.
  const inferred: Step = !profile?.therapist_status
    ? "welcome"
    : triggers.length === 0
      ? "background"
      : triggers.some((t) => t.intensity_score === null)
        ? "trigger-details"
        : signs.length === 0
          ? "warning-signs"
          : !readiness
            ? "readiness"
            : !plan
              ? "safety-plan"
              : !prefs
                ? "companion"
                : !hasOnboardingConversation(user.id)
                  ? "focus-chat"
                  : "summary";
  const step: Step = STEPS.includes(stepParam as Step) ? (stepParam as Step) : inferred;
  const position = STEPS.indexOf(step) + 1;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between text-sm text-olive">
        <span>Step 4 of 4 — Getting set up · current place: {position} of {STEPS.length}</span>
        <Link href="/crisis" className="font-semibold text-support underline">
          Need help now?
        </Link>
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i < position ? "bg-sage" : "bg-sand/60"}`}
          />
        ))}
      </div>

      {step === "welcome" && (
        <section className="mt-10">
          <h1 className="font-serif text-4xl font-medium">Welcome to Steady</h1>
          <p className="mt-4 text-lg leading-relaxed text-olive">
            We&apos;ll start slowly. This setup helps Steady understand your triggers, your
            current state, and what kind of support may feel safest for you. You can pause
            anytime, and you can change any answer later.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            <Link
              href="/onboarding/profile?step=support"
              className="rounded-full bg-sage px-8 py-3.5 text-center font-medium text-ground transition-colors hover:bg-sage-deep"
            >
              Begin slowly
            </Link>
            <Link
              href="/ground"
              className="rounded-full border border-ground/20 px-8 py-3.5 text-center text-ground/80 transition-colors hover:bg-moss"
            >
              I need grounding first
            </Link>
          </div>
        </section>
      )}

      {step === "support" && (
        <form action={saveSupportStatus} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">Your current support</h1>
          <fieldset className="mt-6">
            <legend className="font-medium">
              Are you currently working with a therapist, counselor, or mental health provider?
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill type="radio" name="therapist_status" value="yes" label="Yes" required />
              <Pill type="radio" name="therapist_status" value="no" label="No" />
              <Pill type="radio" name="therapist_status" value="previously" label="Not currently, but I have before" />
              <Pill type="radio" name="therapist_status" value="prefer_not_to_say" label="Prefer not to say" />
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">Have you done EMDR before?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill type="radio" name="emdr_experience" value="yes" label="Yes" required />
              <Pill type="radio" name="emdr_experience" value="no" label="No" />
              <Pill type="radio" name="emdr_experience" value="not_sure" label="I'm not sure" />
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">What are you hoping Steady helps with?</legend>
            <p className="text-sm text-olive">Choose any that fit.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {GOALS.map((g) => (
                <Pill key={g} type="checkbox" name="goal" value={g} label={g} />
              ))}
            </div>
          </fieldset>
          <NextButton />
        </form>
      )}

      {step === "background" && (
        <form action={saveTraumaContext} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">A little background</h1>
          <p className="mt-2 text-olive">
            Broad strokes only — Steady will never ask you to describe traumatic events in
            detail here.
          </p>
          <fieldset className="mt-6">
            <legend className="font-medium">
              Which areas feel connected to what you are working through?
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {TRAUMA_AREAS.map((a) => (
                <Pill key={a} type="checkbox" name="area" value={a} label={a} />
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-7 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <legend className="px-1 font-medium">
              Should Steady avoid any topic unless you bring it up first?
            </legend>
            <div className="mt-2 flex gap-2">
              <Pill type="radio" name="restrict" value="yes" label="Yes" required />
              <Pill type="radio" name="restrict" value="no" label="No" />
            </div>
            <p className="mt-3 text-sm text-olive">If yes, choose the topics to keep off-limits:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TRAUMA_AREAS.filter((a) => a !== "Prefer not to say").map((a) => (
                <Pill key={a} type="checkbox" name="restricted_topic" value={a} label={a} />
              ))}
            </div>
          </fieldset>
          <NextButton />
        </form>
      )}

      {step === "triggers" && (
        <form action={saveTriggers} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">Known triggers</h1>
          <p className="mt-2 leading-relaxed text-olive">
            Triggers are experiences that can make your nervous system react as if danger is
            present. Choose any that feel familiar. You can edit this anytime.
          </p>
          {TRIGGER_CATALOG.map((cat) => (
            <fieldset key={cat.category} className="mt-7">
              <legend className="font-medium">{cat.label}</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {cat.triggers.map((t) => (
                  <Pill
                    key={t}
                    type="checkbox"
                    name="trigger"
                    value={`${cat.category}|${t}`}
                    label={t}
                    defaultChecked={triggers.some((ut) => ut.trigger_name === t)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          <label className="mt-7 block">
            <span className="font-medium">Anything else? (separate with commas)</span>
            <input
              type="text"
              name="custom_triggers"
              placeholder="e.g. Being asked to hurry, certain phrases"
              className="mt-2 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
          </label>
          <NextButton />
        </form>
      )}

      {step === "trigger-details" && (
        <form action={saveTriggerDetails} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">How these show up</h1>
          <p className="mt-2 text-olive">
            For each trigger: how intense it feels right now, and what usually happens when it
            shows up.
          </p>
          {triggers.length === 0 && (
            <p className="mt-6 text-olive">
              No triggers selected — you can{" "}
              <Link href="/onboarding/profile?step=triggers" className="underline">
                go back
              </Link>{" "}
              or continue.
            </p>
          )}
          {triggers.map((t) => (
            <fieldset key={t.id} className="mt-6 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <legend className="px-1 font-medium">{t.trigger_name}</legend>
              <p className="mt-1 text-sm text-olive">How intense is this for you right now?</p>
              <div className="mt-2">
                <ScaleRow name={`intensity-${t.id}`} low="Barely" high="Very intense" />
              </div>
              <p className="mt-4 text-sm text-olive">What usually happens?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TRIGGER_RESPONSES.map((r) => (
                  <Pill key={r} type="checkbox" name={`resp-${t.id}`} value={r} label={r} />
                ))}
              </div>
            </fieldset>
          ))}
          <NextButton />
        </form>
      )}

      {step === "warning-signs" && (
        <form action={saveWarningSigns} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">Early warning signs</h1>
          <p className="mt-2 leading-relaxed text-olive">
            Before things feel overwhelming, your body may give you early signals. Which signs
            show up first? Your companion uses these to suggest grounding earlier.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {WARNING_SIGNS.map((s) => (
              <Pill key={s} type="checkbox" name="sign" value={s} label={s} defaultChecked={signs.includes(s)} />
            ))}
          </div>
          <NextButton />
        </form>
      )}

      {step === "readiness" && (
        <form action={saveReadinessAssessment} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">Where you are today</h1>
          <p className="mt-2 text-olive">
            This shapes your starting track. There is no passing or failing — only pacing.
          </p>
          <fieldset className="mt-7 space-y-2.5">
            <legend className="font-medium">How steady do you feel today?</legend>
            <ScaleRow name="stability" low="Not steady" high="Very steady" />
          </fieldset>
          <fieldset className="mt-7 space-y-2.5">
            <legend className="font-medium">How safe do you feel in your body today?</legend>
            <ScaleRow name="body_safety" low="Not safe" high="Very safe" />
          </fieldset>
          <fieldset className="mt-7 space-y-2.5">
            <legend className="font-medium">How connected do you feel to the present moment?</legend>
            <ScaleRow name="present_connection" low="Far away" high="Fully here" />
          </fieldset>
          <fieldset className="mt-7 space-y-2.5">
            <legend className="font-medium">How intense have your symptoms felt this week?</legend>
            <ScaleRow name="symptom_intensity" low="Mild" high="Very intense" />
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">How well have you been sleeping?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill type="radio" name="sleep" value="good" label="Good" required />
              <Pill type="radio" name="sleep" value="okay" label="Okay" />
              <Pill type="radio" name="sleep" value="poor" label="Poor" />
              <Pill type="radio" name="sleep" value="very_poor" label="Very poor" />
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">
              When you think about working with trauma memories, what feels true?
            </legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill type="radio" name="processing" value="ready" label="I feel ready" required />
              <Pill type="radio" name="processing" value="curious" label="Curious but nervous" />
              <Pill type="radio" name="processing" value="unsure" label="Unsure" />
              <Pill type="radio" name="processing" value="overwhelmed" label="Overwhelmed" />
              <Pill type="radio" name="processing" value="not_now" label="Not right now" />
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">Do you have support available outside the app?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill type="radio" name="support" value="yes" label="Yes" required />
              <Pill type="radio" name="support" value="sometimes" label="Sometimes" />
              <Pill type="radio" name="support" value="no" label="No" />
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">Are you able to stop an exercise if it becomes too intense?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill type="radio" name="pause" value="yes" label="Yes" required />
              <Pill type="radio" name="pause" value="think_so" label="I think so" />
              <Pill type="radio" name="pause" value="not_sure" label="I'm not sure" />
              <Pill type="radio" name="pause" value="no" label="No" />
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">What pace feels safest?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill type="radio" name="pace" value="very_slow" label="Very slow" required />
              <Pill type="radio" name="pace" value="slow" label="Slow" />
              <Pill type="radio" name="pace" value="moderate" label="Moderate" />
              <Pill type="radio" name="pace" value="not_sure" label="I'm not sure" />
            </div>
          </fieldset>
          <fieldset className="mt-7 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <legend className="px-1 font-medium">
              Have you had thoughts of harming yourself or someone else recently?
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill type="radio" name="risk" value="none" label="No" required />
              <Pill type="radio" name="risk" value="safe_now" label="Yes, but I feel safe right now" />
              <Pill type="radio" name="risk" value="not_safe" label="Yes, and I may not be safe" />
            </div>
            <p className="mt-3 text-xs text-olive">
              Honest answers route you to the safest support. If you may not be safe, Steady
              will pause setup and show crisis resources first.
            </p>
          </fieldset>
          <NextButton />
        </form>
      )}

      {step === "safety-plan" && (
        <form action={saveSafetyPlan} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">Your safety plan</h1>
          <p className="mt-2 leading-relaxed text-olive">
            Before deeper work, Steady needs to know what helps you come back to the present.
          </p>
          <fieldset className="mt-6">
            <legend className="font-medium">What helps you feel grounded?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {GROUNDING_TOOLS.map((t) => (
                <Pill key={t} type="checkbox" name="tool" value={t} label={t} />
              ))}
            </div>
            <input
              type="text"
              name="custom_tool"
              placeholder="Something else that helps"
              className="mt-3 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
          </fieldset>
          <fieldset className="mt-7 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <legend className="px-1 font-medium">Who can you contact if you need support?</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                name="contact_name"
                placeholder="Name and relationship"
                className="rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
              />
              <input
                type="text"
                name="contact_method"
                placeholder="Phone number or contact method"
                className="rounded-2xl border border-ground/15 bg-ivory px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
              />
            </div>
          </fieldset>
          <label className="mt-7 block">
            <span className="font-medium">What should Steady remind you when you are overwhelmed?</span>
            <textarea
              name="reminder"
              rows={2}
              placeholder="e.g. This feeling is a wave. It will pass. I am not in that moment anymore."
              className="mt-2 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
          </label>
          <label className="mt-6 block">
            <span className="font-medium">What are signs that you should stop a session?</span>
            <textarea
              name="stop_signs"
              rows={2}
              placeholder="e.g. Feeling unreal, going numb, losing track of the room"
              className="mt-2 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
          </label>
          <label className="mt-6 block">
            <span className="font-medium">What topics should Steady handle carefully?</span>
            <textarea
              name="careful_topics"
              rows={2}
              className="mt-2 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
          </label>
          <NextButton />
        </form>
      )}

      {step === "companion" && (
        <form action={saveCompanionPrefs} className="mt-10">
          <h1 className="font-serif text-3xl font-medium">Your companion</h1>
          <p className="mt-2 leading-relaxed text-olive">
            Steady includes a companion that can remember your triggers, your preferred
            grounding tools, your current state, and what helps you feel safer. You control
            what it remembers. It is not a therapist, and it never replaces emergency care.
          </p>
          <fieldset className="mt-6">
            <legend className="font-medium">What would you like your companion to help with?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMPANION_SUPPORT_MODES.map((m) => (
                <Pill key={m} type="checkbox" name="mode" value={m} label={m} />
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">What tone feels best?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMPANION_TONES.map((t) => (
                <Pill key={t} type="radio" name="tone" value={t} label={t} required={t === COMPANION_TONES[0]} />
              ))}
            </div>
          </fieldset>
          <fieldset className="mt-7">
            <legend className="font-medium">What should the companion avoid?</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {COMPANION_AVOIDANCES.map((a) => (
                <Pill key={a} type="checkbox" name="avoid" value={a} label={a} />
              ))}
            </div>
          </fieldset>
          <label className="mt-7 block">
            <span className="font-medium">What would you like the companion to call you?</span>
            <input
              type="text"
              name="preferred_name"
              placeholder="A name or nothing at all"
              className="mt-2 w-full rounded-2xl border border-ground/15 bg-linen px-4 py-2.5 text-sm focus:border-sage focus:outline-none"
            />
          </label>
          <fieldset className="mt-7 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <legend className="px-1 font-medium">
              Should the companion remember your triggers and grounding preferences?
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill type="radio" name="memory" value="yes" label="Yes" required />
              <Pill type="radio" name="memory" value="no" label="No" />
              <Pill type="radio" name="memory" value="ask" label="Ask me each time" />
            </div>
            <p className="mt-3 text-xs text-olive">
              You can view, edit, or delete everything it remembers under Settings → Memory, anytime.
            </p>
          </fieldset>
          <NextButton />
        </form>
      )}

      {step === "focus-chat" && (
        <section className="mt-10">
          <h1 className="font-serif text-3xl font-medium">In your own words</h1>
          <p className="mt-2 leading-relaxed text-olive">
            The checkboxes gave Steady the outline — this conversation fills it in. Your
            companion will ask the kinds of questions a first intake would, so your sessions
            can aim at the right things. Headlines are enough; nothing here asks you to
            relive anything, and you can pass on any question.
          </p>
          <div className="mt-6 rounded-3xl border border-ground/10 bg-ivory p-5 shadow-soft">
            <CompanionChat
              initialMessages={[]}
              contextType="onboarding"
              greeting={(() => {
                const name = prefs?.preferred_user_name ? ` ${prefs.preferred_user_name}` : "";
                const restricted = new Set(
                  JSON.parse(profile?.restricted_topics_json ?? "[]") as string[]
                );
                const area = (JSON.parse(profile?.trauma_areas_json ?? "[]") as string[]).find(
                  (a) => a !== "Prefer not to say" && !restricted.has(a)
                );
                return area
                  ? `Hi${name} — I'm your Steady companion. During setup you marked ${area.toLowerCase()} as part of what you're working through. I'd like to understand what that actually looks like in your life right now, so your sessions aim at the right things. Where does it show up most these days?`
                  : `Hi${name} — I'm your Steady companion. Before you head to your dashboard, I'd like to understand what you're carrying and what you most want to be different — the way you'd describe it, not the way a form would. What brought you here?`;
              })()}
              doneHref="/onboarding/profile?step=summary"
              doneLabel="I've shared enough — continue"
            />
          </div>
        </section>
      )}

      {step === "summary" && (
        <section className="mt-10">
          <h1 className="font-serif text-4xl font-medium">Your starting place</h1>
          {readiness && (
            <div className="mt-6 rounded-3xl bg-ground p-7 text-ivory shadow-soft">
              <p className="text-sm text-ivory/70">Your starting track</p>
              <p className="mt-1 font-serif text-3xl font-medium">
                {TRACK_LABELS[readiness.recommended_track]}
              </p>
              <p className="mt-3 text-ivory/80">{TRACK_GUIDANCE[readiness.recommended_track]}</p>
              <p className="mt-3 text-sm text-ivory/60">
                Readiness {readiness.calculated_readiness_score}/100 — recalculated gently as you
                check in each day.
              </p>
            </div>
          )}
          {focusAreas.length > 0 && (
            <div className="mt-5 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="font-semibold">What you want to work on</h2>
              <ul className="mt-2 space-y-1 text-sm text-olive">
                {focusAreas.slice(0, 6).map((f) => (
                  <li key={f.id}>
                    <span className="font-medium text-ground">{f.memory_key}</span> — {f.memory_value}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-olive">
                These come back as focus choices when you start a session.
              </p>
            </div>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="font-semibold">Top triggers</h2>
              <ul className="mt-2 space-y-1 text-sm text-olive">
                {triggers.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    {t.trigger_name}
                    {t.intensity_score !== null ? ` · ${t.intensity_score}/10` : ""}
                  </li>
                ))}
                {triggers.length === 0 && <li>None recorded yet.</li>}
              </ul>
            </div>
            <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="font-semibold">Early warning signs</h2>
              <ul className="mt-2 space-y-1 text-sm text-olive">
                {signs.slice(0, 5).map((s) => (
                  <li key={s}>{s}</li>
                ))}
                {signs.length === 0 && <li>None recorded yet.</li>}
              </ul>
            </div>
            <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="font-semibold">Grounding tools</h2>
              <ul className="mt-2 space-y-1 text-sm text-olive">
                {(plan ? (JSON.parse(plan.grounding_tools_json) as string[]) : []).slice(0, 5).map((t) => (
                  <li key={t}>{t}</li>
                ))}
                {!plan && <li>No safety plan yet.</li>}
              </ul>
            </div>
            <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="font-semibold">Companion</h2>
              <ul className="mt-2 space-y-1 text-sm text-olive">
                <li>Tone: {prefs?.tone ?? "Gentle"}</li>
                <li>
                  Memory:{" "}
                  {prefs?.memory_enabled === "no" ? "off" : prefs?.memory_enabled === "ask" ? "asks first" : "on"}
                </li>
                {prefs?.preferred_user_name && <li>Calls you: {prefs.preferred_user_name}</li>}
              </ul>
            </div>
          </div>
          <form action={completeOnboardingProfile} className="mt-8">
            <button
              type="submit"
              className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
            >
              Go to my dashboard
            </button>
          </form>
          <Link
            href="/onboarding/profile?step=triggers"
            className="mt-3 block text-center text-sm text-olive underline"
          >
            Edit my plan
          </Link>
        </section>
      )}
    </main>
  );
}
