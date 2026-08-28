import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { MemberNav } from "@/components/member/MemberNav";
import { MODULES } from "@/lib/modules";
import { checkModuleAccess } from "@/lib/gating";

export const dynamic = "force-dynamic";

// Activities (Web GUI handoff §26: "Choose an allowed support tool — approved
// activity list — Open activity").
//
// Two things live here now. The practices, which were always here, and the
// guided module list, which moved off Today.
//
// §10.1 forbids the catalog on Today — "No full module catalog on Today" —
// because §3.4 found that stacking everything Steady can do onto the first
// screen "makes the member decide what matters now. On a hard day, that choice
// load is exactly what the system should reduce." The catalog is not the
// problem; the catalog *as the front door* is. Here it is what the member came
// looking for.
//
// What deliberately does NOT come across: the unlock-request form and the
// per-module gating explanations. §26 gives this screen one job, "open
// activity", and a member acceptance rule of one dominant action per page. A
// module that is not open says so and stops there.
//
// The practices index.
//
// It did not exist. The four practices were reachable only from tiles on the
// dashboard, so anyone who navigated away had no route back to them — and the
// new nav linked here, to a 404. Adding the nav is what surfaced it, which is
// the usual way a missing index page is found.
//
// These are always available. They are not gated by the day's shape, a tier, or
// a successful write: the regulate suite and grounding are part of the safety
// floor, and putting them behind anything would make a bad day the day they
// disappear.

const PRACTICES = [
  {
    href: "/app/activities/breathe",
    name: "Breathe",
    body: "A few minutes of paced breathing to settle — before a session, or any time.",
    minutes: 5,
  },
  {
    href: "/app/activities/meditate",
    name: "Meditate",
    body: "Short guided practices — grounding, calm place, self-compassion. Read aloud or as text.",
    minutes: 10,
  },
  {
    href: "/app/activities/move",
    name: "Move",
    body: "Gentle guided movement — orienting turns, rooting, shaking off what a day left behind.",
    minutes: 8,
  },
  {
    href: "/app/activities/sleep",
    name: "Sleep",
    body: "Guided wind-downs to do lying down — slow breathing, body scan, and a quiet close.",
    minutes: 12,
  },
];

export default async function ActivitiesPage() {
  const user = await requireMember();

  const moduleList = await Promise.all(
    MODULES.map(async (mod) => ({
      mod,
      open: (await checkModuleAccess(user.id, mod)).allowed,
    }))
  );

  return (
    <>
      <MemberNav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="type-identity text-3xl">Practices</h1>
        <p className="measure mt-2 text-olive">
          Short things you can do on their own, whenever you want them. Nothing here needs
          to lead anywhere.
        </p>

        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {PRACTICES.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                data-testid="practice-card"
                className="block rounded-3xl border border-ground/10 bg-linen px-5 py-5 transition-colors hover:bg-moss/30"
              >
                <p className="type-display text-xl">{p.name}</p>
                <p className="measure mt-1 text-sm text-olive">{p.body}</p>
                <p className="mt-2 text-sm text-olive">About {p.minutes} minutes</p>
              </Link>
            </li>
          ))}
        </ul>

        {/* The guided sessions. Ordered by the program's own sequence rather
            than by what happens to be open, so the shape of the programme stays
            legible even when most of it is not available today. */}
        <section className="mt-12" aria-labelledby="sessions">
          <h2 id="sessions" className="type-identity text-2xl">Guided sessions</h2>
          <p className="measure mt-2 text-olive">
            These follow a sequence. What is open today depends on your check-in and where
            you are in the programme.
          </p>
          <ul className="mt-6 space-y-3">
            {moduleList.map(({ mod, open }) => (
              <li
                key={mod.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-ground/10 bg-linen p-5"
              >
                <div className="min-w-0">
                  <p className="font-medium text-ground">{mod.name}</p>
                  <p className="measure mt-0.5 text-sm text-olive">
                    {mod.objective} · {mod.durationLabel}
                  </p>
                </div>
                {open ? (
                  <Link
                    href={`/app/session/${mod.id}`}
                    className="shrink-0 rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-ground/90"
                  >
                    Open
                  </Link>
                ) : (
                  // Absent rather than disabled, and without the reason. §4's
                  // rule for member surfaces is that absent is absent — a
                  // greyed row with an explanation invites the member to work
                  // out how to qualify, which is the pressure the gate exists
                  // to remove.
                  <span className="shrink-0 text-sm text-olive">Not open today</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <p className="measure mt-10 text-sm text-olive">
          Grounding and crisis support are always one tap away, on every screen, whether or
          not anything else is open today.
        </p>
      </main>
    </>
  );
}
