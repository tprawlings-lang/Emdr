import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { MemberNav } from "@/components/member/MemberNav";

export const dynamic = "force-dynamic";

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
    href: "/practices/breathe",
    name: "Breathe",
    body: "A few minutes of paced breathing to settle — before a session, or any time.",
    minutes: 5,
  },
  {
    href: "/practices/meditate",
    name: "Meditate",
    body: "Short guided practices — grounding, calm place, self-compassion. Read aloud or as text.",
    minutes: 10,
  },
  {
    href: "/practices/move",
    name: "Move",
    body: "Gentle guided movement — orienting turns, rooting, shaking off what a day left behind.",
    minutes: 8,
  },
  {
    href: "/practices/sleep",
    name: "Sleep",
    body: "Guided wind-downs to do lying down — slow breathing, body scan, and a quiet close.",
    minutes: 12,
  },
];

export default async function PracticesPage() {
  await requireMember();

  return (
    <>
      <MemberNav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="type-display text-3xl">Practices</h1>
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

        <p className="measure mt-8 text-sm text-olive">
          Grounding and crisis support are always one tap away, on every screen, whether or
          not anything else is open today.
        </p>
      </main>
    </>
  );
}
