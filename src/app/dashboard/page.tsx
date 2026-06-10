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

function actionLabel(action: string): { label: string; tone: string } {
  switch (action) {
    case "processing_ok":
      return { label: "All cleared modules available today", tone: "text-green-700 bg-green-50 border-green-200" };
    case "stabilization":
      return { label: "Lower intensity today — stabilization modules open", tone: "text-amber-800 bg-amber-50 border-amber-200" };
    case "grounding_only":
      return { label: "Grounding only today (Calm Place, Containment)", tone: "text-amber-800 bg-amber-50 border-amber-200" };
    case "crisis":
      return { label: "Sessions paused — your care team has been alerted", tone: "text-red-800 bg-red-50 border-red-200" };
    default:
      return { label: action, tone: "text-stone-700 bg-stone-50 border-stone-200" };
  }
}

export default async function DashboardPage() {
  const user = await requireMember();
  if (!hasConsent(user.id)) redirect("/onboarding");
  if (!screeningComplete(user.id)) redirect("/screening");

  const db = getDb();
  const checkin = getTodayCheckin(user.id);

  const pcl5 = db
    .prepare(
      "SELECT total_score, created_at FROM screenings WHERE user_id = ? AND instrument = 'pcl-5' ORDER BY created_at ASC"
    )
    .all(user.id) as { total_score: number; created_at: string }[];

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
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Hello, {user.name}</h1>
        <div className="flex items-center gap-4">
          <Link href="/crisis" className="text-sm font-semibold text-red-700 underline">
            Need help now?
          </Link>
          <form action={logout}>
            <button className="text-sm text-stone-500 underline">Sign out</button>
          </form>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-500">Check-ins completed</p>
          <p className="mt-1 text-2xl font-bold">{streak.n}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-500">Last clinician review</p>
          <p className="mt-1 text-lg font-semibold">
            {lastReview?.reviewed_at ? lastReview.reviewed_at.slice(0, 10) : "Pending"}
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-500">PCL-5 trend</p>
          <p className="mt-1 text-lg font-semibold">
            {pcl5.length > 0 ? `${pcl5[pcl5.length - 1].total_score} / 80` : "—"}
            {pcl5.length > 1 && (
              <span className="ml-2 text-sm font-normal text-stone-500">
                (was {pcl5[0].total_score})
              </span>
            )}
          </p>
        </div>
      </div>

      {!checkin ? (
        <div className="mt-6 rounded-lg border border-stone-900 bg-stone-900 p-6 text-white">
          <h2 className="text-lg font-semibold">Today&apos;s best next step</h2>
          <p className="mt-1 text-stone-300">
            Complete your daily check-in (under 90 seconds). All sessions route through it.
          </p>
          <Link
            href="/check-in"
            className="mt-4 inline-block rounded-lg bg-white px-5 py-2.5 font-medium text-stone-900 hover:bg-stone-200"
          >
            Start check-in
          </Link>
        </div>
      ) : (
        <div className={`mt-6 rounded-lg border p-4 ${actionLabel(checkin.recommended_action).tone}`}>
          <p className="font-medium">
            Today&apos;s check-in: {actionLabel(checkin.recommended_action).label}
          </p>
        </div>
      )}

      <h2 className="mt-10 text-xl font-bold">Your program</h2>
      <p className="mt-1 text-sm text-stone-600">
        Modules marked “Specialist gated” unlock only after your care team reviews your
        readiness. That pacing is part of the treatment design, not a paywall.
      </p>

      <div className="mt-4 space-y-3">
        {MODULES.map((mod) => {
          const access = checkModuleAccess(user.id, mod);
          const unlock = mod.tier === "gated" ? getUnlock(user.id, mod.id) : null;
          return (
            <div key={mod.id} className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {mod.order}. {mod.name}
                    {mod.tier === "gated" && (
                      <span className="ml-2 rounded-sm bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">
                        Specialist gated
                      </span>
                    )}
                    {mod.tier === "maintenance" && (
                      <span className="ml-2 rounded-sm bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                        Maintenance
                      </span>
                    )}
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    {mod.objective} · {mod.durationLabel}
                  </p>
                </div>
                {access.allowed ? (
                  <Link
                    href={`/session/${mod.id}`}
                    className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
                  >
                    Start session
                  </Link>
                ) : (
                  <span className="rounded-lg border border-stone-200 bg-stone-100 px-4 py-2 text-sm text-stone-500">
                    Locked
                  </span>
                )}
              </div>
              {!access.allowed && (
                <p className="mt-2 text-sm text-stone-500">{access.reason}</p>
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
                      className="min-w-64 flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
                    />
                    <button className="rounded-lg border border-stone-900 px-4 py-1.5 text-sm font-medium hover:bg-stone-100">
                      Request specialist review
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
