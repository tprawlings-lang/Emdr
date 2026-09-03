import { AppShell } from "@/components/app/AppShell";
import { MEMBER_RAIL } from "@/lib/app/rails";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { hasConsent, screeningComplete } from "@/lib/gating";
import { getActiveTriggers, profileComplete } from "@/lib/profile";
import { submitCheckin } from "@/lib/actions";

function ScaleInput({
  name,
  low,
  high,
}: {
  name: string;
  low: string;
  high: string;
}) {
  // Six steps, not eleven. The mockup draws wide bordered boxes with the ends
  // named inside them — "0 calm" through "8 intense" — and that is a different
  // instrument from eleven small circles: a position on a labelled range
  // rather than a score out of ten. It is also reachable with an imprecise
  // tap, which is the point on a screen someone opens at 2am.
  const STEPS = [0, 2, 4, 6, 8, 10];
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {STEPS.map((v, i) => (
          <label
            key={v}
            className="flex min-w-20 flex-1 cursor-pointer items-center justify-center rounded-xl border border-ground/15 bg-app-surface px-3 py-3.5 text-sm transition-colors hover:bg-app-accent/50 has-checked:border-app-ink/30 has-checked:bg-app-accent has-checked:font-semibold"
          >
            <input type="radio" name={name} value={v} required className="sr-only" />
            {i === 0 ? `${v} ${low}` : i === STEPS.length - 1 ? `${v} ${high}` : v}
          </label>
        ))}
      </div>
    </div>
  );
}

function YesNo({ name }: { name: string }) {
  return (
    <div className="flex gap-2">
      {["no", "yes"].map((v) => (
        <label
          key={v}
          className="cursor-pointer rounded-full border border-ground/15 bg-linen px-6 py-2 text-sm capitalize transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold"
        >
          <input type="radio" name={name} value={v} required className="sr-only" />
          {v}
        </label>
      ))}
    </div>
  );
}

export default async function CheckinPage() {
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");
  if (!(await hasConsent(user.id))) redirect("/app/onboarding");
  if (!(await screeningComplete(user.id))) redirect("/app/screening");
  if (!(await profileComplete(user.id))) redirect("/app/onboarding/profile");

  const triggers = await getActiveTriggers(user.id);

  return (
    <AppShell
      role="Patient or member"
      title="Daily check-in"
      active="overview"
      railHref={MEMBER_RAIL}
    >
      <p className="measure text-olive">
        Under 90 seconds. Your answers shape today&apos;s safest next step — honest answers keep
        sessions safe. There are no wrong answers.
      </p>

      <form action={submitCheckin} className="mt-10 space-y-8">
        <fieldset className="space-y-2.5">
          <legend className="font-medium">How activated do you feel right now?</legend>
          <ScaleInput name="activation" low="calm" high="intense" />
        </fieldset>

        <fieldset className="space-y-2.5">
          <legend className="font-medium">How down or shut down do you feel?</legend>
          <ScaleInput name="shutdown" low="not at all" high="shut down" />
        </fieldset>

        <fieldset className="space-y-2.5 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <legend className="px-1 font-medium">Any urge to harm yourself or others today?</legend>
          <YesNo name="harm_urge" />
        </fieldset>

        <fieldset className="space-y-2.5 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <legend className="px-1 font-medium">Do you feel safe where you are?</legend>
          <YesNo name="feels_safe" />
        </fieldset>

        <fieldset className="space-y-2.5">
          <legend className="font-medium">
            Do you feel unreal, numb, or disconnected right now?
          </legend>
          <ScaleInput name="dissociation" low="present" high="disconnected" />
        </fieldset>

        <fieldset className="space-y-2.5">
          <legend className="font-medium">How did you sleep?</legend>
          <ScaleInput name="sleep_quality" low="badly" high="well" />
        </fieldset>

        <fieldset className="space-y-2.5 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <legend className="px-1 font-medium">
            Any alcohol or drug use that could affect today&apos;s session?
          </legend>
          <YesNo name="substance_flag" />
        </fieldset>

        {triggers.length > 0 && (
          <fieldset className="space-y-2.5 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <legend className="px-1 font-medium">
              Did any of your known triggers show up today? (optional)
            </legend>
            <div className="flex flex-wrap gap-2">
              {triggers.map((t) => (
                <label
                  key={t.id}
                  className="cursor-pointer rounded-full border border-ground/15 bg-ivory px-4 py-2 text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold"
                >
                  <input type="checkbox" name="trigger_today" value={t.id} className="sr-only" />
                  {t.trigger_name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* The mockup pairs a filled Continue with an outlined Pause. Pause is
            a peer of Continue, not an escape hatch styled to be avoided:
            stopping a check-in partway is a legitimate outcome, and §26 lists
            "Continue or pause" as this screen's primary action. */}
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded-full bg-app-ink px-7 py-3.5 font-medium text-app-surface transition-opacity hover:opacity-90"
          >
            Continue
          </button>
          <Link
            href="/app/today"
            className="rounded-full border border-ground/25 px-7 py-3.5 font-medium text-app-ink transition-colors hover:bg-app-accent/50"
          >
            Pause
          </Link>
        </div>
      </form>
    </AppShell>
  );
}
