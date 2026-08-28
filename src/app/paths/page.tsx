import { MemberNav } from "@/components/member/MemberNav";
import Link from "next/link";
import { buildMemberDay } from "@/lib/member/view";
import { DayCanvas } from "@/components/member/DayCanvas";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { subscriptionActive } from "@/lib/billing";
import { MODULES } from "@/lib/modules";
import { completedModuleIds } from "@/lib/gating";
import {
  EVIDENCE_LABELS,
  EvidenceGrade,
  INTAKE_OPTIONS,
  TRACKS,
  getMemberTracks,
  getTrackIntake,
  isReferralOnly,
  nextModuleId,
} from "@/lib/tracks";
import { recommendTracks } from "@/lib/track-recommender";
import { removeCareTrack, saveTrackIntakeAction, selectCareTrack } from "@/lib/actions";

const GRADE_TONE: Record<EvidenceGrade, string> = {
  high: "bg-safe/20 text-state-safe border-safe/40",
  moderate: "bg-mist/30 text-ground border-mist/50",
  emerging: "bg-clay/25 text-ground border-clay/50",
  specialist: "bg-pause-soft text-ground border-pause/50",
};

function EvidenceBadge({ grade }: { grade: EvidenceGrade }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${GRADE_TONE[grade]}`}>
      {EVIDENCE_LABELS[grade]}
    </span>
  );
}

function moduleName(id: string): string {
  return MODULES.find((m) => m.id === id)?.name ?? id;
}

export default async function PathsPage() {
  const user = await requireMember();
  if (!(await subscriptionActive(user.id))) redirect("/subscribe");

  const intake = await getTrackIntake(user.id);
  const savedTags = new Set(intake?.tags ?? []);
  const rec = await recommendTracks(user.id);
  const day = await buildMemberDay(user.id);
  const myTracks = await getMemberTracks(user.id);
  const myTrackIds = new Set(myTracks.map((t) => t.id));
  const completed = await completedModuleIds(user.id);

  return (
    <>
      <MemberNav />
      <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="text-sm text-olive underline">
          ← Dashboard
        </Link>
        <Link href="/crisis" className="text-sm font-semibold text-ground underline">
          Need help now?
        </Link>
      </div>

      <h1 className="mt-4 type-display text-4xl font-medium">Find your path</h1>
      <p className="mt-2 text-olive">
        Tell us what you&apos;d like to work on, in your own words. We&apos;ll point you to a
        starting place — and you can follow more than one path, or change at any time.
      </p>

      {/* Goal intake */}
      <form action={saveTrackIntakeAction} className="mt-8 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
        <label htmlFor="goalText" className="block font-semibold">
          What would you like to be different?
        </label>
        <textarea
          id="goalText"
          name="goalText"
          rows={2}
          defaultValue={intake?.goalText ?? ""}
          placeholder="e.g. I want the nightmares to stop, or I freeze when I hear yelling"
          className="mt-2 w-full rounded-2xl border border-ground/15 bg-ivory px-4 py-3 text-sm focus:border-sage focus:outline-none"
        />
        <p className="mt-4 text-sm font-medium text-ground">Pick anything that fits — as many as you like:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTAKE_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className="cursor-pointer rounded-full border border-ground/20 bg-ivory px-4 py-2 text-sm text-ground/80 transition-colors has-[:checked]:border-sage has-[:checked]:bg-sage has-[:checked]:text-ground"
            >
              <input
                type="checkbox"
                name="tags"
                value={opt.id}
                defaultChecked={savedTags.has(opt.id)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
        <button className="mt-5 rounded-full bg-ground px-6 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-olive">
          Update my suggestions
        </button>
      </form>

      {/* The day comes first. Paths are a longer-horizon choice; what is open
          right now is the thing a member came to find, and §4's one-primary-task
          rule means it should not be underneath a form. */}
      <DayCanvas day={day} />

      {/* Recommendation */}
      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium">Suggested for you</h2>
        <p className="mt-1 text-sm text-olive">{rec.memberMessage}</p>

        {rec.safety.level !== "ok" && rec.safety.action && (
          <div className="mt-3 rounded-3xl border border-pause/40 bg-pause-soft p-5">
            <p className="text-sm text-ground/90">{rec.safety.reason}</p>
            <Link
              href={rec.safety.action === "crisis" ? "/crisis" : rec.safety.action === "checkin" ? "/check-in" : "/screening"}
              className="mt-3 inline-block rounded-full bg-sage px-5 py-2 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
            >
              {rec.safety.action === "crisis" ? "Open support options" : rec.safety.action === "checkin" ? "Do today's check-in" : "Answer the questions"}
            </Link>
          </div>
        )}

        {rec.safety.level === "ok" && (
          <div className="mt-4 space-y-3">
            {rec.candidates.map((c) => {
              const track = TRACKS.find((t) => t.id === c.trackId)!;
              const already = myTrackIds.has(c.trackId);
              return (
                <div key={c.trackId} className="rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{track.name}</h3>
                    <EvidenceBadge grade={track.evidenceGrade} />
                    {c.referralOnly && (
                      <span className="rounded-full border border-pause/50 bg-pause-soft px-2.5 py-0.5 text-xs font-medium text-ground">
                        Specialist referral
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-olive">{track.blurb}</p>
                  <ul className="mt-3 space-y-1 text-sm text-ground/80">
                    {c.rationale.map((r, i) => (
                      <li key={i}>· {r}</li>
                    ))}
                  </ul>
                  {already ? (
                    <p className="mt-4 text-sm font-medium text-state-safe">On your paths ✓</p>
                  ) : (
                    <form action={selectCareTrack} className="mt-4">
                      <input type="hidden" name="trackId" value={c.trackId} />
                      <button className="rounded-full bg-sage px-5 py-2 text-sm font-medium text-ground transition-colors hover:bg-sage-deep">
                        Add this path
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
            {rec.candidates.length === 0 && (
              <p className="rounded-3xl border border-ground/10 bg-linen p-6 text-sm text-olive shadow-soft">
                Once you share a little above, your suggestions appear here. You can always browse
                every path below.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Current paths */}
      {myTracks.length > 0 && (
        <section className="mt-10">
          <h2 className="type-display text-2xl font-medium">Your paths</h2>
          <div className="mt-4 space-y-3">
            {myTracks.map((track) => {
              const next = nextModuleId(track, completed);
              return (
                <div key={track.id} className="rounded-3xl border border-ground/10 bg-ground p-6 text-ivory shadow-soft">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{track.name}</h3>
                    <EvidenceBadge grade={track.evidenceGrade} />
                  </div>
                  <p className="mt-2 text-sm text-ivory/80">{track.blurb}</p>
                  {isReferralOnly(track) && track.referralNote && (
                    <p className="mt-2 rounded-2xl bg-ivory/10 px-4 py-2 text-sm text-ivory/85">
                      {track.referralNote}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {next ? (
                      <Link
                        href={`/session/${next}`}
                        className="rounded-full bg-sage px-5 py-2 text-sm font-medium text-ground transition-colors hover:bg-sage-deep"
                      >
                        Next: {moduleName(next)}
                      </Link>
                    ) : (
                      <span className="text-sm text-ivory/70">You&apos;ve worked through this path&apos;s steps.</span>
                    )}
                    <form action={removeCareTrack}>
                      <input type="hidden" name="trackId" value={track.id} />
                      <button className="text-sm text-ivory/70 underline">Remove</button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Browse all */}
      <section className="mt-10">
        <h2 className="type-display text-2xl font-medium">Explore every path</h2>
        <p className="mt-1 text-sm text-olive">
          Different paths suit different needs — and you may need more than one. Evidence grades
          are shown honestly so you can choose with open eyes.
        </p>
        <div className="mt-4 space-y-3">
          {TRACKS.map((track) => {
            const already = myTrackIds.has(track.id);
            return (
              <details key={track.id} className="rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-semibold">
                  {track.name}
                  <EvidenceBadge grade={track.evidenceGrade} />
                  {isReferralOnly(track) && (
                    <span className="rounded-full border border-pause/50 bg-pause-soft px-2.5 py-0.5 text-xs font-medium text-ground">
                      Specialist referral
                    </span>
                  )}
                  {already && <span className="text-xs font-medium text-state-safe">· on your paths</span>}
                </summary>
                <p className="mt-3 text-sm text-ground/80">{track.scope}</p>
                <p className="mt-2 text-sm text-olive">{track.evidenceNote}</p>
                <p className="mt-3 text-xs uppercase tracking-wide text-olive">Steps it draws on</p>
                <p className="mt-1 text-sm text-ground/80">
                  {track.moduleIds.map(moduleName).join(" → ")}
                </p>
                {track.referralNote && (
                  <p className="mt-3 rounded-2xl bg-pause-soft px-4 py-2 text-sm text-ground/90">
                    {track.referralNote}
                  </p>
                )}
                {!already && (
                  <form action={selectCareTrack} className="mt-4">
                    <input type="hidden" name="trackId" value={track.id} />
                    <button className="rounded-full border border-ground px-5 py-2 text-sm font-medium transition-colors hover:bg-ground hover:text-ivory">
                      Add this path
                    </button>
                  </form>
                )}
              </details>
            );
          })}
        </div>
        <p className="mt-6 text-xs text-olive">
          Paths suggest a focus and order. Each step still opens through your check-in, readiness,
          and your specialist&apos;s review — a path never skips those.
        </p>
      </section>
    </main>
    </>
  );
}
