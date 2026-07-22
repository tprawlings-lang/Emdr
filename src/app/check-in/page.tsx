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
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");
  if (!profileComplete(user.id)) redirect("/onboarding/profile");

  const triggers = getActiveTriggers(user.id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-4xl font-medium">Daily check-in</h1>
        <Link href="/crisis" className="text-sm font-semibold text-support underline">
          Need help now?
        </Link>
      </div>
      <p className="mt-2 text-sm text-olive">
        Under 90 seconds. Your answers shape today&apos;s safest next step — honest answers keep
        sessions safe. There are no wrong answers.
      </p>

      <form action={submitCheckin} className="mt-10 space-y-8">
        <fieldset className="space-y-2.5">
          <legend className="font-medium">How activated do you feel right now?</legend>
          <ScaleInput name="activation" low="Completely calm" high="Extremely activated" />
        </fieldset>

        <fieldset className="space-y-2.5">
          <legend className="font-medium">How down or shut down do you feel?</legend>
          <ScaleInput name="shutdown" low="Not at all" high="Completely shut down" />
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
          <ScaleInput name="dissociation" low="Fully present" high="Very disconnected" />
        </fieldset>

        <fieldset className="space-y-2.5">
          <legend className="font-medium">How did you sleep?</legend>
          <ScaleInput name="sleep_quality" low="Terribly" high="Very well" />
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

        <button
          type="submit"
          className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
        >
          See today&apos;s gentle next step
        </button>
      </form>
    </main>
  );
}
