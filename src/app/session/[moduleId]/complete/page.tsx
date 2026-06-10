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
          className="cursor-pointer rounded-full border border-ground/15 bg-linen px-6 py-2 text-sm capitalize transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold"
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
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-ground/15 bg-linen text-sm transition-colors hover:bg-moss has-checked:border-clay has-checked:bg-clay has-checked:font-semibold"
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
      <h1 className="font-serif text-4xl font-medium">Before you go</h1>
      <p className="mt-2 text-sm text-olive">
        Two minutes. You do not need to solve everything today — this is how we make sure the
        session landed safely, so your system can settle.
      </p>

      <form action={submitPostSessionCheck} className="mt-10 space-y-8">
        <input type="hidden" name="sessionId" value={sid} />

        <fieldset className="space-y-2.5">
          <legend className="font-medium">What is your distress right now? (0–10)</legend>
          <Scale name="distress" />
        </fieldset>

        <fieldset className="space-y-2.5 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <legend className="px-1 font-medium">
            Quick orientation check: do you know what room you are in, what day it is, and can
            you feel your feet on the floor?
          </legend>
          <YesNo name="oriented" />
        </fieldset>

        <fieldset className="space-y-2.5 rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <legend className="px-1 font-medium">Can you stay safe until tomorrow?</legend>
          <YesNo name="safe_tonight" />
        </fieldset>

        <fieldset className="space-y-2.5">
          <legend className="font-medium">
            How likely are nightmares, urges, or shutdown tonight? (0 = not at all, 10 = certain)
          </legend>
          <Scale name="delayed_risk" />
        </fieldset>

        <fieldset className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <legend className="px-1 font-medium">Your recovery plan for the next few hours</legend>
          <ul className="mt-2 list-disc pl-5 text-sm text-ground/90">
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
          className="w-full rounded-full bg-sage px-6 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
        >
          Save reflection
        </button>
        <p className="text-center text-sm text-olive">Let your system settle.</p>
      </form>
    </main>
  );
}
