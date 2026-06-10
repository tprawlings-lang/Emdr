import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { MODULES } from "@/lib/modules";
import {
  checkModuleAccess,
  getTodayCheckin,
  getUnlock,
  hasConsent,
  screeningComplete,
} from "@/lib/gating";
import { logout, requestUnlock } from "@/lib/actions";
import { scoreItq } from "@/lib/instruments";
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

export default async function DashboardPage() {
  const user = await requireMember();
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");
  if (!profileComplete(user.id)) redirect("/onboarding/profile");

  const db = getDb();
  const checkin = getTodayCheckin(user.id);
  const readiness = getLatestReadiness(user.id);
  const triggers = getActiveTriggers(user.id);
  const plan = getSafetyPlan(user.id);
  const groundingTools: string[] = plan ? JSON.parse(plan.grounding_tools_json) : [];
  const todayTriggerIds: string[] = checkin?.triggers_json ? JSON.parse(checkin.triggers_json) : [];
  const todayTriggers = triggers.filter((t) => todayTriggerIds.includes(t.id));

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
    ...scoreItq(JSON.parse(r.answers_json)),
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

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
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

      <h2 className="mt-12 font-serif text-2xl font-medium">Your program</h2>
      <p className="mt-1 text-sm text-olive">
        Modules marked “Specialist gated” open only after your care team reviews your
        readiness. That pacing is part of the treatment design, not a paywall.
      </p>

      <div className="mt-4 space-y-3">
        {MODULES.map((mod) => {
          const access = checkModuleAccess(user.id, mod);
          const unlock = mod.tier === "gated" ? getUnlock(user.id, mod.id) : null;
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
                <p className="mt-2 text-sm text-olive">{access.reason}</p>
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
