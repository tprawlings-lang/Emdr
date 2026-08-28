import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { getMemberTracks } from "@/lib/tracks";
import { getProgramPlan } from "@/lib/program-plan";
import { MemberPage } from "@/components/member/MemberPage";
import { ReviewBadge } from "@/components/clinical/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your care plan — Steady" };

// Care plan (§26: "Know what is active and why — versioned plan and authority
// — Message care team").
//
// This is where the paths and the program plan went when §10.1 cleared them off
// Today. §26 gives them a screen whose question is specifically "what is active,
// and why" — which is not the same question as "what should I do now", and
// mixing the two was part of what made Today a catalog.
//
// "Versioned plan and AUTHORITY" is the load-bearing half. §9.3 requires model
// content to carry its status wherever it appears, and the program plan is
// model-drafted. On Today it was rendered as a card with a heading and a list,
// styled like every other card — which is precisely what §9.3 forbids: "Do not
// style model output like a system fact." Here it says what it is, and that
// nobody has reviewed it.

export default async function CarePlanPage() {
  const user = await requireMember();
  const [tracks, planRow] = await Promise.all([
    getMemberTracks(user.id),
    getProgramPlan(user.id),
  ]);

  return (
    <MemberPage
      title="Your care plan"
      lede="What is active for you at the moment, where it came from, and who has looked at it."
    >
      <section aria-labelledby="paths">
        <h2 id="paths" className="text-xs font-semibold uppercase tracking-wide text-olive">
          Your paths
        </h2>
        {tracks.length === 0 ? (
          <p className="measure mt-3 text-sm text-olive">
            You have not chosen a path yet. Paths are optional — the sessions and practices
            work without one.{" "}
            <Link href="/app/paths" className="text-state-info underline">Browse paths</Link>
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {tracks.map((t) => (
              <li key={t.id} className="rounded-3xl border border-ground/10 bg-linen p-5">
                <p className="font-medium text-ground">{t.name}</p>
                <p className="measure mt-1 text-sm text-ground/90">{t.blurb}</p>
                {/* §26 asks for authority alongside the plan. The evidence note
                    is the member-facing half of that, and it is honest about
                    strength rather than implying every path is equally proven. */}
                <p className="measure mt-2 text-xs text-olive">{t.evidenceNote}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {planRow && (
        <section aria-labelledby="program" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="program" className="text-xs font-semibold uppercase tracking-wide text-olive">
              Suggested programme
            </h2>
            {/* §9.3: model content never appears without its status. This is a
                draft nobody has approved, and saying so is the difference
                between a suggestion and an instruction. */}
            <ReviewBadge state={planRow.generated_by === "ai" ? "draft" : "validated"} />
          </div>

          <div className="mt-3 rounded-3xl border border-ground/10 bg-linen p-5">
            <p className="measure text-ground/90">{planRow.plan.summary}</p>

            {planRow.plan.nextSteps.length > 0 && (
              <ul className="mt-4 space-y-2">
                {planRow.plan.nextSteps.map((s, i) => (
                  <li key={i} className="text-sm text-ground/90">
                    <span className="font-medium">{s.focus}</span>
                    {/* The "why" is the part that makes a plan a plan rather
                        than a list. It is also model-drafted, which the badge
                        above already says once — saying it per line would turn
                        a caveat into noise. */}
                    <span className="block text-olive">{s.why}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="measure mt-4 border-t border-ground/10 pt-3 text-xs text-olive">
              {planRow.generated_by === "ai"
                ? "Drafted automatically from what you have recorded. No clinician has reviewed it, and it does not change what is open to you — the safety rules decide that."
                : "Assembled from fixed rules rather than a model."}{" "}
              Generated {planRow.created_at.slice(0, 10)}.
            </p>
          </div>
        </section>
      )}

      <p className="measure mt-8 text-sm text-olive">
        Who can see any of this is listed under{" "}
        <Link href="/app/care-team" className="text-state-info underline">care team</Link>.
      </p>
    </MemberPage>
  );
}
