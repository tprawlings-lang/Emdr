import { getCurrentUser } from "@/lib/auth";
import { acknowledgeCrisis } from "@/lib/actions";

// Crisis screen: large text, one action at a time, no marketing, no upsell,
// no unrelated links (executive plan guardrails). Colors stay muted per the
// brand kit, but action buttons remain large and unmistakable.
export default async function CrisisPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const user = await getCurrentUser();

  return (
    <main className="mx-auto max-w-xl px-6 py-14">
      <h1 className="font-serif text-4xl font-medium text-support-deep">Pause and get support</h1>
      <p className="mt-3 text-lg text-ground">
        {from
          ? "Based on what you just told us, the safest step is to pause the program and get support. Your care team has been notified and will review today."
          : "If you are struggling right now, pause the program and get support."}
      </p>

      <div className="mt-8 space-y-4">
        <a
          href="tel:988"
          className="block rounded-3xl bg-support px-6 py-5 text-center text-xl font-bold text-white transition-colors hover:bg-support-deep"
        >
          Call or text 988 — Suicide &amp; Crisis Lifeline (US)
        </a>
        <a
          href="tel:911"
          className="block rounded-3xl border-2 border-support px-6 py-4 text-center text-lg font-semibold text-support-deep transition-colors hover:bg-support/10"
        >
          In immediate danger? Call 911
        </a>
      </div>

      <div className="mt-10 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
        <h2 className="font-serif text-2xl font-medium">Ground yourself while you reach out</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-ground/90">
          <li>Feel your feet on the floor. Press them down.</li>
          <li>Name five things you can see, four you can hear, three you can touch.</li>
          <li>Breathe out slowly, longer than you breathe in. Repeat five times.</li>
          <li>If you can, move to a place where someone you trust is nearby.</li>
        </ol>
      </div>

      <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
        <h2 className="font-serif text-2xl font-medium">Is someone with you, or can someone be?</h2>
        <p className="mt-2 text-ground/90">
          Reach out to one safe person now — a call or a text. You do not have to explain
          everything. “Can you stay on the phone with me for a bit?” is enough.
        </p>
      </div>

      {user?.role === "member" && (
        <form action={acknowledgeCrisis} className="mt-10">
          <button className="w-full rounded-full border border-ground/20 px-6 py-3 text-ground/80 transition-colors hover:bg-moss">
            I am safe right now — back to my dashboard
          </button>
          <p className="mt-2 text-center text-xs text-olive">
            Sessions stay paused until your specialist reviews today&apos;s alert.
          </p>
        </form>
      )}
    </main>
  );
}
