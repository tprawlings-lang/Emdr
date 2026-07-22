import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import {
  checkModuleAccess,
  completedModuleIds,
  getTodayCheckin,
  getUnlock,
  hasConsent,
  screeningComplete,
} from "@/lib/gating";
import { logout, requestUnlock } from "@/lib/actions";
import { scoreItq } from "@/lib/instruments";
import { decryptField } from "@/lib/crypto";
import { getFitnessState } from "@/lib/fitness-screener";
import { getProgramPlan } from "@/lib/program-plan";
import { getMemberTracks, nextModuleId } from "@/lib/tracks";
import {
  TRACK_GUIDANCE,
  TRACK_LABELS,
  getActiveTriggers,
  getLatestReadiness,
  getSafetyPlan,
  profileComplete,
} from "@/lib/profile";
import TrendChart from "@/components/TrendChart";

function actionLabel(action: string): { label: string; tone: string } {
  switch (action) {
    case "processing_ok":
      return { label: "Safe to continue — all cleared modules are open today", tone: "text-ground bg-safe/15 border-safe/40" };
    case "stabilization":
      return { label: "A gentler day — stabilization modules are open", tone: "text-ground bg-pause-soft border-pause/40" };
    case "grounding_only":
      return { label: "Grounding only today (Calm Place, Containment)", tone: "text-ground bg-pause-soft border-pause/40" };
    case "crisis":
      return { label: "Sessions paused — your care team has been alerted", tone: "text-support-deep bg-support/10 border-support/40" };
    default:
      return { label: action, tone: "text-ground bg-linen border-ground/10" };
  }
}

// Where each blocked-module reason can actually be resolved. Without these
// links, members told "complete X first" had no path to X (the bug that
// stranded grandfathered accounts after the fit screener shipped).
const ACTION_LINKS: Record<string, { href: string; label: string }> = {
  screening: { href: "/screening", label: "Answer them now" },
  checkin: { href: "/check-in", label: "Do today's check-in" },
  profile: { href: "/onboarding/profile", label: "Finish getting set up" },
  safety_plan: { href: "/onboarding/profile?step=safety-plan", label: "Complete your safety plan" },
  consent: { href: "/onboarding", label: "Review consent" },
  subscribe: { href: "/subscribe", label: "Restart membership" },
  grounding: { href: "/ground", label: "Ground now" },
  crisis: { href: "/crisis", label: "Open support" },
};

export default async function DashboardPage() {
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");
  if (!(await hasConsent(user.id))) redirect("/onboarding");
  if (!(await screeningComplete(user.id))) redirect("/screening");
  if (!(await profileComplete(user.id))) redirect("/onboarding/profile");

  const db = getDb();
  const checkin = await getTodayCheckin(user.id);
  const fitness = await getFitnessState(user.id);
  const planRow = await getProgramPlan(user.id);
  const readiness = await getLatestReadiness(user.id);
  const triggers = await getActiveTriggers(user.id);
  const plan = await getSafetyPlan(user.id);
  const groundingTools: string[] = plan ? JSON.parse(plan.grounding_tools_json) : [];
  const todayTriggerIds: string[] = checkin?.triggers_json ? JSON.parse(checkin.triggers_json) : [];
  const todayTriggers = triggers.filter((t) => todayTriggerIds.includes(t.id));
  const myTracks = await getMemberTracks(user.id);
  const completed = await completedModuleIds(user.id);

  const pcl5 = db
    .prepare(
      "SELECT total_score, created_at FROM screenings WHERE user_id = ? AND instrument = 'pcl-5' ORDER BY created_at ASC"
    )
    .all(user.id) as { total_score: number; created_at: string }[];

  const itqRows = db
    .prepare(
      "SELECT answers_json, created_at FROM screenings WHERE user_id = ? AND instrument = 'itq' ORDER BY created_at ASC"
    )
    .all(user.id) as { answers_json: string; created_at: string }[];
  const itqScores = itqRows.map((r) => ({
    date: r.created_at.slice(0, 10),
    ...scoreItq(JSON.parse(decryptField(r.answers_json))),
  }));

  const recentMeasures = db
    .prepare(
      `SELECT COUNT(*) AS n FROM screenings
       WHERE user_id = ? AND instrument IN ('pcl-5','itq')
         AND created_at >= datetime('now', '-7 days')`
    )
    .get(user.id) as { n: number };
  const measureDue = recentMeasures.n === 0;

  const lastReview = db
    .prepare(
      `SELECT reviewed_at FROM alerts WHERE user_id = ? AND status = 'reviewed'
       ORDER BY reviewed_at DESC LIMIT 1`
    )
    .get(user.id) as { reviewed_at: string } | undefined;

  const streak = db
    .prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?")
    .get(user.id) as { n: number };

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

  return (
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
            href="/screening"
            className="mt-3 inline-block rounded-full bg-sage px-6 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            Answer the fit questions
          </Link>
        </div>
      )}
      {fitness.status === "cooldown" && (
        <div className="mb-6 rounded-3xl border border-support/40 bg-support/10 p-5">
          <p className="font-semibold text-support-deep">Sessions are paused right now</p>
          <p className="mt-1 text-sm text-ground/90">
            Based on your fit answers, the safest step today is support from a person. The
            crisis page has options that can help right now, and you can revisit the
            questions in {fitness.retakeInHours ?? 24}h.
          </p>
          <Link href="/crisis" className="mt-3 inline-block rounded-full bg-support px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-support-deep">
            Open support options
          </Link>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-4xl font-medium">Hello, {user.name}</h1>
          <p className="mt-1 text-sm text-olive">You are here today. That is enough.</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/crisis" className="text-sm font-semibold text-support underline">
            Need help now?
          </Link>
          <Link href="/settings/memory" className="text-sm text-olive underline">
            Memory
          </Link>
          <Link href="/settings/billing" className="text-sm text-olive underline">
            Membership
          </Link>
          <form action={logout}>
            <button className="text-sm text-olive underline">Sign out</button>
          </form>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <p className="text-sm text-olive">Check-ins so far</p>
          <p className="mt-1 text-2xl font-semibold">{streak.n}</p>
        </div>
        <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <p className="text-sm text-olive">Last specialist review</p>
          <p className="mt-1 text-lg font-semibold">
            {lastReview?.reviewed_at ? lastReview.reviewed_at.slice(0, 10) : "Pending"}
          </p>
        </div>
        <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <p className="text-sm text-olive">PCL-5 trend</p>
          <p className="mt-1 text-lg font-semibold">
            {pcl5.length > 0 ? `${pcl5[pcl5.length - 1].total_score} / 80` : "—"}
            {pcl5.length > 1 && (
              <span className="ml-2 text-sm font-normal text-olive">
                (was {pcl5[0].total_score})
              </span>
            )}
          </p>
        </div>
      </div>

      {!checkin ? (
        <div className="mt-6 rounded-3xl bg-ground p-7 text-ivory shadow-soft">
          <h2 className="font-serif text-2xl font-medium">Today&apos;s gentle next step</h2>
          <p className="mt-2 text-ivory/80">
            A short check-in — under 90 seconds. Every session moves through it first.
          </p>
          <Link
            href="/check-in"
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
          <Link href="/ground" className="mt-2 inline-block text-sm font-medium underline">
            Ground now
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {readiness && (
          <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-olive">Current place</p>
              <p className="text-sm text-olive">{readiness.calculated_readiness_score}/100</p>
            </div>
            <p className="mt-1 font-serif text-2xl font-medium">
              {TRACK_LABELS[readiness.recommended_track]}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-olive">
              {TRACK_GUIDANCE[readiness.recommended_track]}
            </p>
          </div>
        )}
        <div className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
          <p className="text-sm text-olive">Your companion</p>
          <p className="mt-1 font-serif text-2xl font-medium">Here when you need it</p>
          <p className="mt-2 text-sm leading-relaxed text-olive">
            It remembers your triggers, grounding tools, and pace — and you control its memory.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/companion"
              className="rounded-full bg-sage px-5 py-2 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
            >
              Check in with it
            </Link>
            <Link
              href="/ground"
              className="rounded-full border border-ground/20 px-5 py-2 text-sm text-ground/80 transition-colors hover:bg-moss"
            >
              Ground now
            </Link>
          </div>
        </div>
      </div>

      {measureDue && (
        <div className="mt-4 rounded-3xl border border-mist/60 bg-mist/20 p-5">
          <p className="font-medium">
            Your weekly measures are due — about five minutes, and they keep your trend honest.
          </p>
          <Link
            href="/measures"
            className="mt-3 inline-block rounded-full bg-mist-deep px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-ground"
          >
            Take weekly measures
          </Link>
        </div>
      )}

      {(pcl5.length > 0 || itqScores.length > 0) && (
        <>
          <div className="mt-12 flex items-baseline justify-between">
            <h2 className="font-serif text-2xl font-medium">Your progress</h2>
            <Link href="/measures" className="text-sm text-olive underline">
              Weekly measures
            </Link>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {pcl5.length > 0 && (
              <TrendChart
                title="PTSD symptoms (PCL-5)"
                max={80}
                series={[
                  {
                    label: "PCL-5",
                    color: "#2f3a33",
                    points: pcl5.map((p) => ({
                      date: p.created_at.slice(0, 10),
                      value: p.total_score,
                    })),
                  },
                ]}
              />
            )}
            {itqScores.length > 0 && (
              <TrendChart
                title="ICD-11 trauma symptoms (ITQ)"
                max={24}
                series={[
                  {
                    label: "PTSD",
                    color: "#5c7884",
                    points: itqScores.map((s) => ({ date: s.date, value: s.ptsdSum })),
                  },
                  {
                    label: "Self-organization (DSO)",
                    color: "#c9a98f",
                    points: itqScores.map((s) => ({ date: s.date, value: s.dsoSum })),
                  },
                ]}
              />
            )}
          </div>
        </>
      )}

      {myTracks.length > 0 ? (
        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="font-serif text-2xl font-medium">Your paths</h2>
            <Link href="/paths" className="text-sm text-olive underline">
              Manage paths
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {myTracks.map((track) => {
              const next = nextModuleId(track, completed);
              return (
                <div key={track.id} className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
                  <h3 className="font-semibold">{track.name}</h3>
                  <p className="mt-1 text-sm text-olive">{track.blurb}</p>
                  {next ? (
                    <Link
                      href={`/session/${next}`}
                      className="mt-3 inline-block rounded-full bg-sage px-5 py-2 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
                    >
                      Next: {MODULES.find((m) => m.id === next)?.name ?? next}
                    </Link>
                  ) : (
                    <p className="mt-3 text-sm text-olive">You&apos;ve worked through this path&apos;s steps.</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="mt-12 rounded-3xl border border-clay/40 bg-clay/15 p-6">
          <h2 className="font-serif text-2xl font-medium">Find your path</h2>
          <p className="mt-2 text-sm text-ground/90">
            Tell us what you&apos;d like to work on and we&apos;ll suggest where to start — trauma,
            anxiety, a specific fear, grief, and more. You can follow more than one.
          </p>
          <Link
            href="/paths"
            className="mt-4 inline-block rounded-full bg-ground px-6 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-olive"
          >
            Explore paths
          </Link>
        </section>
      )}

      {planRow && (
        <section className="mt-12 rounded-3xl border border-ground/10 bg-ground p-7 text-ivory shadow-soft">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-serif text-2xl font-medium">Your program plan</h2>
            <p className="text-xs text-ivory/60">
              Updated {planRow.created_at.slice(0, 10)} ·{" "}
              {planRow.generated_by === "ai" ? "drafted by your companion" : "from your map"} ·
              shared with your care team
            </p>
          </div>
          <p className="mt-3 text-ivory/85">{planRow.plan.summary}</p>
          {planRow.plan.nextSteps.length > 0 && (
            <ol className="mt-4 space-y-3">
              {planRow.plan.nextSteps.map((s, i) => {
                const mod = MODULES.find((m) => m.id === s.moduleId);
                return (
                  <li key={i} className="rounded-2xl bg-ivory/10 px-4 py-3">
                    <p className="text-sm font-semibold">
                      {i + 1}. {mod?.name ?? s.moduleId} — focus: {s.focus}
                    </p>
                    <p className="mt-0.5 text-sm text-ivory/70">{s.why}</p>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-4 text-xs text-ivory/60">
            A working plan, not a prescription — your specialist&apos;s review always comes
            first, and it refreshes when your trigger map changes.
          </p>
        </section>
      )}

      <h2 className="mt-12 font-serif text-2xl font-medium">Your program</h2>
      <p className="mt-1 text-sm text-olive">
        Modules marked “Specialist gated” open only after your care team reviews your
        readiness. That pacing is part of the treatment design, not a paywall.
      </p>

      <div className="mt-4 space-y-3">
        {modulesWithAccess.map(({ mod, access, unlock }) => {
          return (
            <div key={mod.id} className="rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {mod.order}. {mod.name}
                    {mod.tier === "gated" && (
                      <span className="ml-2 rounded-full bg-clay/30 px-2.5 py-0.5 text-xs font-medium text-ground">
                        Specialist gated
                      </span>
                    )}
                    {mod.tier === "maintenance" && (
                      <span className="ml-2 rounded-full bg-mist/40 px-2.5 py-0.5 text-xs font-medium text-ground">
                        Maintenance
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-sm text-olive">
                    {mod.objective} · {mod.durationLabel}
                  </p>
                </div>
                {access.allowed ? (
                  <Link
                    href={`/session/${mod.id}`}
                    className="rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
                  >
                    Begin session
                  </Link>
                ) : (
                  <span className="rounded-full border border-ground/10 bg-sand/40 px-5 py-2.5 text-sm text-olive">
                    Not yet open
                  </span>
                )}
              </div>
              {!access.allowed && (
                <p className="mt-2 text-sm text-olive">
                  {access.reason}
                  {ACTION_LINKS[access.action] && (
                    <>
                      {" "}
                      <Link
                        href={ACTION_LINKS[access.action].href}
                        className="font-medium text-ground underline"
                      >
                        {ACTION_LINKS[access.action].label}
                      </Link>
                    </>
                  )}
                </p>
              )}
              {!access.allowed &&
                access.action === "unlock" &&
                (!unlock || unlock.status === "revoked") && (
                  <form action={requestUnlock} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="moduleId" value={mod.id} />
                    <input
                      type="text"
                      name="note"
                      placeholder="Optional note for your specialist"
                      className="min-w-64 flex-1 rounded-2xl border border-ground/15 bg-ivory px-4 py-2 text-sm focus:border-sage focus:outline-none"
                    />
                    <button className="rounded-full border border-ground px-5 py-2 text-sm font-medium transition-colors hover:bg-ground hover:text-ivory">
                      Send to specialist
                    </button>
                  </form>
                )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
