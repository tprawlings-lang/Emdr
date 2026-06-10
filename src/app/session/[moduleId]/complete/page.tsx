import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { submitPostSessionCheck } from "@/lib/actions";

function YesNo({ name }: { name: string }) {
  return (
    <div className="flex gap-2">
      {["yes", "no"].map((v) => (
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

function Scale({ name }: { name: string }) {
  return (
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
  );
}

// Post-session flow answers four questions: did the user return to baseline,
// are they safe now, is delayed worsening likely, and does a clinician need
// to review this session (executive plan).
export default async function PostSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ sid?: string }>;
}) {
  const { sid } = await searchParams;
  const user = await requireMember();
  if (!sid) redirect("/dashboard");

  const db = getDb();
  const session = db
    .prepare("SELECT id FROM therapy_sessions WHERE id = ? AND user_id = ?")
    .get(sid, user.id);
  if (!session) redirect("/dashboard");

  const alreadyChecked = db
    .prepare("SELECT id FROM post_session_checks WHERE session_id = ?")
    .get(sid);
  if (alreadyChecked) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold">Before you go</h1>
      <p className="mt-2 text-sm text-stone-600">
        Two minutes. This is how we make sure today&apos;s session landed safely.
      </p>

      <form action={submitPostSessionCheck} className="mt-8 space-y-7">
        <input type="hidden" name="sessionId" value={sid} />

        <fieldset className="space-y-2">
          <legend className="font-medium">What is your distress right now? (0–10)</legend>
          <Scale name="distress" />
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
          <legend className="px-1 font-medium">
            Quick orientation check: do you know what room you are in, what day it is, and can
            you feel your feet on the floor?
          </legend>
          <YesNo name="oriented" />
        </fieldset>

        <fieldset className="space-y-2 rounded-lg border border-stone-200 bg-white p-4">
          <legend className="px-1 font-medium">Can you stay safe until tomorrow?</legend>
          <YesNo name="safe_tonight" />
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-medium">
            How likely are nightmares, urges, or shutdown tonight? (0 = not at all, 10 = certain)
          </legend>
          <Scale name="delayed_risk" />
        </fieldset>

        <fieldset className="rounded-lg border border-stone-200 bg-white p-4">
          <legend className="px-1 font-medium">Your recovery plan for the next few hours</legend>
          <ul className="mt-2 list-disc pl-5 text-sm text-stone-700">
            <li>Drink water and eat something.</li>
            <li>Gentle movement — a short walk counts.</li>
            <li>No alcohol tonight.</li>
            <li>Know which support person you would contact.</li>
            <li>Plan a quiet, low-demand task for this evening.</li>
          </ul>
          <label className="mt-3 flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="recovery_confirmed" required />
            I have read my recovery plan and will follow it.
          </label>
        </fieldset>

        <button
          type="submit"
          className="w-full rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
        >
          Finish
        </button>
      </form>
    </main>
  );
}
