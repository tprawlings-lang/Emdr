import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { checkModuleAccess, getTodayCheckin } from "@/lib/gating";
import { MemberPage } from "@/components/member/MemberPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Before you begin — Steady" };

// Session preparation (§26: "Confirm readiness and environment — readiness and
// fixed gates — Begin check").
//
// The deliberate beat before a session starts. Handoff 04 §6 asked for the same
// thing on the other side of the gate — "this transition needs an explicit
// confirmation beat… the member should have to actively step into the set, not
// slide into it."
//
// The environment questions are not a form and nothing is stored. They are
// there because a session that starts badly is usually one that started in the
// wrong place — interrupted, in public, with ten minutes before something else.
// A member reading them and deciding to come back later is this screen working,
// not failing, which is why "not now" is a peer of "begin" rather than a
// cancel link.

const ENVIRONMENT = [
  "Somewhere you can be undisturbed for the whole session.",
  "A way to sit or lie down comfortably.",
  "Nothing you have to leave for in the next half hour.",
];

export default async function SessionPreparePage({
  searchParams,
}: { searchParams: Promise<{ module?: string }> }) {
  const user = await requireMember();
  const { module: moduleId } = await searchParams;

  const mod = moduleId ? getModule(moduleId) : undefined;
  // Without a module there is nothing to prepare for; the activities list is
  // where a member picks one.
  if (!mod) redirect("/app/activities");

  // The fixed gates are re-checked here rather than trusted from the link that
  // arrived. §30.7's evaluation is authoritative at every entry point, and a
  // member who was cleared an hour ago may not be now.
  const access = await checkModuleAccess(user.id, mod);
  if (!access.allowed) {
    redirect(access.action === "crisis" ? "/crisis" : "/app/today");
  }
  const checkin = await getTodayCheckin(user.id);

  return (
    <MemberPage
      title="Before you begin"
      lede={`${mod.name} — about ${mod.durationLabel}.`}
    >
      <section aria-labelledby="ready" className="rounded-3xl border border-ground/10 bg-linen p-6">
        <h2 id="ready" className="font-medium text-ground">Where you are</h2>
        <ul className="mt-3 space-y-2">
          {ENVIRONMENT.map((e) => (
            <li key={e} className="measure flex gap-2 text-ground/90">
              <span aria-hidden className="text-olive">·</span>
              {e}
            </li>
          ))}
        </ul>
        <p className="measure mt-4 text-sm text-olive">
          Nothing here is recorded. It is a moment to check rather than a question to answer.
        </p>
      </section>

      <section aria-labelledby="during" className="mt-4 rounded-3xl border border-ground/10 bg-ivory p-6">
        <h2 id="during" className="font-medium text-ground">What stays available</h2>
        {/* §26 member acceptance: "Pause, stop, grounding and support remain
            reachable where session activity appears." Saying so before the
            session is what makes them usable during it — a member who has to
            discover the stop button while activated will not find it. */}
        <p className="measure mt-2 text-ground/90">
          Pause and stop stay on screen the whole way through. Grounding is one tap, and it is
          a normal thing to use, not a failure. You can end the session at any point and
          nothing is lost.
        </p>
        {checkin && (
          <p className="measure mt-3 text-sm text-olive">
            Today&apos;s check-in is already recorded, so the safety rules have what they need.
          </p>
        )}
      </section>

      <Link
        href={`/app/session/${mod.id}`}
        className="mt-8 block w-full rounded-full bg-ground px-6 py-4 text-center text-lg font-medium text-ivory transition-colors hover:bg-ground/90"
      >
        Begin
      </Link>
      {/* Not a cancel link. Choosing not to start is a legitimate outcome of
          this screen, and styling it as an escape hatch says otherwise. */}
      <p className="mt-3 text-center text-sm">
        <Link href="/app/today" className="text-state-info underline">
          Not right now
        </Link>
      </p>
    </MemberPage>
  );
}
