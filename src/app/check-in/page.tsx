import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { hasConsent, screeningComplete } from "@/lib/gating";
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
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-stone-300 text-sm hover:bg-stone-100 has-checked:border-stone-900 has-checked:bg-stone-900 has-checked:text-white"
          >
            <input type="radio" name={name} value={v} required className="sr-only" />
            {v}
          </label>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-stone-500">
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
          className="cursor-pointer rounded-lg border border-stone-300 px-5 py-2 text-sm capitalize hover:bg-stone-100 has-checked:border-stone-900 has-checked:bg-stone-900 has-checked:text-white"
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
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Daily check-in</h1>
        <Link href="/crisis" className="text-sm font-semibold text-red-700 underline">
          Need help now?
        </Link>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        Under 90 seconds. Your answers decide today&apos;s safest next step — honest answers keep
        sessions safe.
      </p>

      <form action={submitCheckin} className="mt-8 space-y-7">
        <fieldset className="space-y-2">
          <legend className="font-medium">How activated do you feel right now?</legend>
          <ScaleInput name="activation" low="Completely calm" high="Extremely activated" />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-medium">How down or shut down do you feel?</legend>
          <ScaleInput name="shutdown" low="Not at all" high="Completely shut down" />
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
          <legend className="px-1 font-medium">Any urge to harm yourself or others today?</legend>
          <YesNo name="harm_urge" />
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
          <legend className="px-1 font-medium">Do you feel safe where you are?</legend>
          <YesNo name="feels_safe" />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-medium">
            Do you feel unreal, numb, or disconnected right now?
          </legend>
          <ScaleInput name="dissociation" low="Fully present" high="Very disconnected" />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-medium">How did you sleep?</legend>
          <ScaleInput name="sleep_quality" low="Terribly" high="Very well" />
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
          <legend className="px-1 font-medium">
            Any alcohol or drug use that could affect today&apos;s session?
          </legend>
          <YesNo name="substance_flag" />
        </fieldset>

        <button
          type="submit"
          className="w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
        >
          Get today&apos;s best next step
        </button>
      </form>
    </main>
  );
}
