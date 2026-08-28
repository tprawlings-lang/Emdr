import { MemberNav } from "@/components/member/MemberNav";
import { buildMemberToday } from "@/lib/member/today";
import { TodayDecision } from "@/components/member/TodayDecision";
import { EnvelopeView } from "@/components/presentation/EnvelopeView";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { memberHistory } from "@/lib/member/history";
import { HistoryStrip } from "@/components/member/HistoryStrip";
import { subscriptionActive } from "@/lib/billing";
import { data } from "@/lib/data";
import { MODULES } from "@/lib/modules";
import {
  checkModuleAccess,
  getTodayCheckin,
  getUnlock,
  hasConsent,
  resourcingBlsAvailable,
  screeningComplete,
} from "@/lib/gating";
import { logout } from "@/lib/actions";
import { getFitnessState } from "@/lib/fitness-screener";
import {
  getActiveTriggers,
  getSafetyPlan,
  profileComplete,
} from "@/lib/profile";

function actionLabel(action: string): { label: string; tone: string } {
  switch (action) {
    case "processing_ok":
      return { label: "Safe to continue — all cleared modules are open today", tone: "text-ground bg-safe/15 border-safe/40" };
    case "stabilization":
      return { label: "A gentler day — stabilization modules are open", tone: "text-ground bg-pause-soft border-pause/40" };
    case "grounding_only":
      return { label: "Grounding only today (Calm Place, Containment)", tone: "text-ground bg-pause-soft border-pause/40" };
    case "crisis":
      return { label: "Sessions paused — use the support options below", tone: "text-ground bg-ground/10 border-pause/50" };
    default:
      return { label: action, tone: "text-ground bg-linen border-ground/10" };
  }
}

// Where each blocked-module reason can actually be resolved. Without these
// links, members told "complete X first" had no path to X (the bug that
// stranded grandfathered accounts after the fit screener shipped).

export default async function DashboardPage({
  searchParams,
}: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");
  if (!(await hasConsent(user.id))) redirect("/app/onboarding");
  if (!(await screeningComplete(user.id))) redirect("/app/screening");
  if (!(await profileComplete(user.id))) redirect("/app/onboarding/profile");

  const c = await data();
  const checkin = await getTodayCheckin(user.id);
  const fitness = await getFitnessState(user.id);
  const triggers = await getActiveTriggers(user.id);
  const plan = await getSafetyPlan(user.id);
  const groundingTools: string[] = plan ? JSON.parse(plan.grounding_tools_json) : [];
  const todayTriggerIds: string[] = checkin?.triggers_json ? JSON.parse(checkin.triggers_json) : [];
  const todayTriggers = triggers.filter((t) => todayTriggerIds.includes(t.id));

  // Instrument scores are deliberately NOT fetched here. They were, to feed two
  // trend charts; the boundary only holds if the value never arrives, so the
  // query is gone rather than the render (handoff §3).

  // Wave 1's member vertical slice: the decision surface is served by the
  // member_today projection rather than assembled here. §8 — "the UI should
  // never build clinical meaning by joining raw event arrays" — and §30.1,
  // "the browser receives only the projection and actions authorized for that
  // actor."
  //
  // The rest of this page is still the pre-atlas catalog. Wave 2 replaces it;
  // §3.4's finding (a content catalog that makes the member decide what matters
  // on their worst day) is not fixed by adding a better card above it.
  const tenantRow = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [user.id])) as
    | { tenant_id: string } | undefined;
  const todayEnvelope = await buildMemberToday({
    userId: user.id,
    tenantId: tenantRow?.tenant_id ?? "",
  });
  const history = await memberHistory(user.id, { days: 14 });

  // Precompute module access (checkModuleAccess is async now) so the JSX map
  // below stays synchronous.
  const modulesWithAccess: {
    mod: (typeof MODULES)[number];
    access: Awaited<ReturnType<typeof checkModuleAccess>>;
    unlock: Awaited<ReturnType<typeof getUnlock>>;
  }[] = [];
  for (const mod of MODULES) {
    modulesWithAccess.push({
      mod,
      access: await checkModuleAccess(user.id, mod),
      unlock: mod.tier === "gated" ? await getUnlock(user.id, mod.id) : null,
    });
  }

  // Phase-4a: offer the calm-place (resourcing BLS) session only when the feature
  // is on + consented and today's check-in is complete (the route re-checks the
  // same-day clinical exclusion before rendering any set).
  const resourcingAvail = checkin ? await resourcingBlsAvailable(user.id) : false;

  // Autopilot (Premium): today's composed plan, or null on other tiers.
  const { getAutopilotPlan } = await import("@/lib/autopilot");
  const autopilot = await getAutopilotPlan(user.id);

  return (
    <>
      <MemberNav />
      <main className="mx-auto max-w-4xl px-6 py-12">

      {fitness.status === "none" && (
        <div className="mb-6 rounded-3xl border border-pause/40 bg-pause-soft p-5">
          <p className="font-semibold text-ground">One new step before your next session</p>
          <p className="mt-1 text-sm text-ground/90">
            Steady added eight quick yes-or-no program-fit questions for everyone — including
            members who joined before they existed. Sessions stay closed until they&apos;re
            answered; it takes about a minute.
          </p>
          <Link
            href="/app/screening"
            className="mt-3 inline-block rounded-full bg-sage px-6 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Answer the fit questions
          </Link>
        </div>
      )}
      {fitness.status === "cooldown" && (
        <div className="mb-6 rounded-3xl border border-pause/50 bg-ground/10 p-5">
          <p className="font-semibold text-ground">Sessions are paused right now</p>
          <p className="mt-1 text-sm text-ground/90">
            Based on your fit answers, the safest step today is support from a person. The
            crisis page has options that can help right now, and you can revisit the
            questions in {fitness.retakeInHours ?? 24}h.
          </p>
          <Link href="/crisis" className="mt-3 inline-block rounded-full bg-ground px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-ground">
            Open support options
          </Link>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="type-identity text-4xl font-medium">Hello, {user.name}</h1>
          <p className="mt-1 text-sm text-olive">You are here today. That is enough.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/crisis" className="text-sm font-semibold text-ground underline">
            Need help now?
          </Link>
          <Link href="/app/settings/memory" className="text-sm text-olive underline">
            Memory
          </Link>
          <Link href="/app/settings/billing" className="text-sm text-olive underline">
            Membership
          </Link>
          <form action={logout}>
            <button className="text-sm text-olive underline">Sign out</button>
          </form>
        </div>
      </div>

      {/* §10.1's above-the-fold order: greeting and local date, then the Today
          state card, then one primary action. The card sat above the greeting
          and read as though the page began mid-sentence.

          The projection decides; this renders. EnvelopeView makes §30.8's eight
          states impossible to collapse into one blank screen — in particular a
          policy failure does NOT read as "nothing available today", which is a
          different and false statement to make to a member. */}
      {/* Arriving straight from the check-in. The plan below already reflects
          the answers just given, so this says that rather than making the
          member infer it — and offers the companion as a choice instead of the
          mandatory hop that used to sit between answering and acting. */}
      {from === "checkin" && (
        <p className="mt-6 rounded-3xl border border-state-safe/40 bg-state-safe-bg/50 px-5 py-4 text-sm text-ground">
          Today&apos;s check-in is recorded, and your plan below reflects it.{" "}
          <Link href="/app/companion?from=checkin" className="text-state-info underline">
            Talk it through with the companion
          </Link>
          .
        </p>
      )}

      <div className="mt-8">
        <EnvelopeView envelope={todayEnvelope} title="Today">
          {(today) => <TodayDecision today={today} />}
        </EnvelopeView>
      </div>

      {/* Three stat cards used to sit here: a check-in count, the last review
          date, and "PCL-5 trend — 52 / 80 (was 58)".

          The score card is a Vol 2 violation outright. The count is the subtler
          one: a running total of check-ins is a streak with a different label.
          It creates the same performance pressure, and it turns a missed day —
          often a bad day, the day this product exists for — into a number the
          member is shown on return.

          What replaces them is the day itself. */}
      {/* DayCanvas used to render here. It is handoff 04 §8's version of the
          same surface as TodayDecision above — same primary, same secondaries,
          same source — and rendering both showed the member their three options
          twice. §10.1 is the more specific spec, so it owns the decision; the
          Horizon moved across with it. The component stays defined: its props
          contract is what stops a score reaching a member surface. */}

      {autopilot && (
        <section className="mt-6 rounded-3xl border border-sage-deep/40 bg-moss p-7 shadow-soft">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-sm text-olive">Autopilot · today&apos;s plan</p>
              <h2 className="mt-1 type-display text-2xl font-medium">{autopilot.headline}</h2>
            </div>
            <p className="text-xs text-olive">{autopilot.date}</p>
          </div>
          {autopilot.outreach && (
            <p className="mt-4 rounded-2xl bg-ivory/70 p-4 text-sm leading-relaxed text-ground/90">
              {autopilot.outreach}
            </p>
          )}
          <div className="mt-4 space-y-2.5">
            {autopilot.items.map((item) => (
              <Link
                key={item.href + item.title}
                href={item.href}
                className="flex items-start justify-between gap-3 rounded-2xl border border-ground/10 bg-linen p-4 transition-colors hover:bg-ivory"
              >
                <div>
                  <p className="font-medium text-ground">{item.title}</p>
                  <p className="mt-0.5 text-sm text-olive">{item.detail}</p>
                </div>
                <span className="mt-1 text-olive" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
          {autopilot.pacingNote && (
            <p className="mt-4 text-xs leading-relaxed text-olive">{autopilot.pacingNote}</p>
          )}
        </section>
      )}

      {!checkin ? (
        <div className="mt-6 rounded-3xl bg-ground p-7 text-ivory shadow-soft">
          <h2 className="type-display text-2xl font-medium">Today&apos;s gentle next step</h2>
          <p className="mt-2 text-ivory/80">
            A short check-in — under 90 seconds. Every session moves through it first.
          </p>
          <Link
            href="/app/check-in"
            className="mt-5 inline-block rounded-full bg-sage px-7 py-3 font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Begin check-in
          </Link>
        </div>
      ) : (
        <div className={`mt-6 rounded-3xl border p-5 ${actionLabel(checkin.recommended_action).tone}`}>
          <p className="font-medium">
            Today&apos;s check-in: {actionLabel(checkin.recommended_action).label}
          </p>
        </div>
      )}

      {resourcingAvail && (
        <div className="mt-4 rounded-3xl border border-sage/50 bg-sage/10 p-5">
          <p className="font-medium">A calm-place session is open today</p>
          <p className="mt-1 text-sm text-ground/90">
            Settle into your calm place with a few short, gentle rounds of sound and tapping. You
            can stop any time.
          </p>
          <Link
            href="/app/session/resourcing"
            className="mt-3 inline-block rounded-full bg-sage px-6 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Start calm-place session
          </Link>
        </div>
      )}

      {todayTriggers.length > 0 && (
        <div className="mt-4 rounded-3xl border border-clay/50 bg-clay/15 p-5">
          <p className="font-medium">
            Today connects to {todayTriggers.length === 1 ? "one of your known triggers" : "some of your known triggers"}:{" "}
            {todayTriggers.map((t) => t.trigger_name.toLowerCase()).join(", ")}.
          </p>
          {groundingTools.length > 0 && (
            <p className="mt-1 text-sm text-olive">
              Last time, {groundingTools[0].toLowerCase()} helped. Your grounding tools are one
              tap away.
            </p>
          )}
          <Link href="/app/ground" className="mt-2 inline-block text-sm font-medium underline">
            Ground now
          </Link>
        </div>
      )}

      {/* §10.1's below-the-fold list is short and specific: "up to two safe
          alternatives, completed activity and gentle progress, optional 'why
          this plan?' drawer, upcoming care or review item."
          
          What used to sit here instead: a four-card practice grid, a measures-
          due banner, the member's paths, a "find your path" prompt, the AI
          program plan, and the full twelve-module catalog. §10.1 forbids the
          last one outright — "No full module catalog on Today" — and §3.4 named
          the whole arrangement: "This is a content catalog. It tells the member
          everything Steady can do, but it makes the member decide what matters
          now. On a hard day, that choice load is exactly what the system should
          reduce."
          
          None of it is deleted. The catalog and the practice grid moved to
          /app/activities, which §26 defines as "choose an allowed support tool
          — approved activity list". Paths and the program plan belong to
          /app/plan ("know what is active and why"), which Wave 2 has not built
          yet — the link below is honest about that rather than dropping them
          silently. */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="type-display text-2xl font-medium">What you&rsquo;ve done</h2>
          <Link href="/app/measures" className="text-sm text-olive underline">
            Weekly measures
          </Link>
        </div>
        <HistoryStrip days={history} />
      </section>

      <p className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/app/activities" className="text-state-info underline">
          All activities and sessions
        </Link>
        <Link href="/app/progress" className="text-state-info underline">
          Your progress
        </Link>
      </p>
    </main>
    </>
  );
}
