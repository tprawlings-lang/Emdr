import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { hasConsent, screeningComplete } from "@/lib/gating";
import { profileComplete, TRACK_LABELS } from "@/lib/profile";
import { buildCompanionContext } from "@/lib/companion";
import CompanionChat from "@/components/CompanionChat";

export default async function CompanionPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");
  if (!(await hasConsent(user.id))) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");
  if (!profileComplete(user.id)) redirect("/onboarding/profile");

  const { from } = await searchParams;
  const ctx = await buildCompanionContext(user.id);
  // Arriving fresh from a check-in opens today's daily chat: the companion
  // speaks first, prompted by the numbers just submitted and stored history.
  const dailyChat = from === "checkin" && !!ctx.checkin;
  const name = ctx.prefs?.preferred_user_name?.trim();
  const checkinNote = !ctx.checkin
    ? "I notice you haven't checked in yet today — that's always a good first step."
    : ctx.checkin.recommended_action === "processing_ok"
      ? "Today's check-in looks steady."
      : "Today's check-in suggests keeping things gentle.";
  const greeting = `${name ? `Hello, ${name}. ` : "Hello. "}I'm your Steady companion. ${checkinNote} I can help you ground, prepare for a session, or reflect — at whatever pace feels safe.`;

  const tools: string[] = ctx.plan ? JSON.parse(ctx.plan.grounding_tools_json) : [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-4xl font-medium">Your companion</h1>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="text-olive underline">
            Dashboard
          </Link>
          <Link href="/crisis" className="font-semibold text-support underline">
            Need help now?
          </Link>
        </div>
      </div>

      <details className="mt-4 rounded-3xl border border-pause/40 bg-pause-soft px-5 py-3 text-sm text-ground" open>
        <summary className="cursor-pointer font-semibold">
          Not for emergencies — your companion is not monitored in real time
        </summary>
        <p className="mt-1">
          If you are in danger right now, call or text{" "}
          <a href="tel:988" className="font-semibold underline">988</a> (Suicide &amp; Crisis
          Lifeline) or call 911. The crisis page walks you through it one step at a time.
        </p>
      </details>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_260px]">
        <CompanionChat initialMessages={[]} greeting={greeting} autoStartDaily={dailyChat} />

        <aside className="space-y-4">
          <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <h2 className="text-sm font-semibold">Today</h2>
            {ctx.readiness ? (
              <p className="mt-1 text-sm text-olive">
                Track: {TRACK_LABELS[ctx.readiness.recommended_track]} ·{" "}
                {ctx.readiness.calculated_readiness_score}/100
              </p>
            ) : (
              <p className="mt-1 text-sm text-olive">No readiness assessment yet.</p>
            )}
            {!ctx.checkin && (
              <Link href="/check-in" className="mt-2 inline-block text-sm underline">
                Begin check-in
              </Link>
            )}
          </div>
          {ctx.triggers.length > 0 && (
            <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="text-sm font-semibold">It remembers</h2>
              <ul className="mt-1 space-y-1 text-sm text-olive">
                {ctx.triggers.slice(0, 4).map((t) => (
                  <li key={t.id}>{t.trigger_name}</li>
                ))}
              </ul>
              <Link href="/settings/memory" className="mt-2 inline-block text-xs underline">
                Memory controls
              </Link>
            </div>
          )}
          {tools.length > 0 && (
            <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
              <h2 className="text-sm font-semibold">Your grounding tools</h2>
              <ul className="mt-1 space-y-1 text-sm text-olive">
                {tools.slice(0, 4).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <Link href="/ground" className="mt-2 inline-block text-xs underline">
                Ground now
              </Link>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
