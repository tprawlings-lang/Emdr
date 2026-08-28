import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { MemberPage } from "@/components/member/MemberPage";
import { BOUNDARY } from "@/lib/site/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome — Steady" };

// Welcome (§26: "Understand scope and control — orientation flow — Continue").
//
// The first screen, and the only place a member is told what this is before
// they are asked to do anything. §26's user question is "understand scope and
// control", which is two things: what Steady does, and what stays theirs.
//
// Written as claims a member can check rather than reassurance. "Nothing here
// is monitored in real time" is a fact they can verify against the trust page;
// "you are in safe hands" is not a fact at all. §31.8's claims rule applies to
// member copy as much as to a payer deck: nothing presented as demonstrated
// that is not.

const SCOPE: Array<{ heading: string; body: string }> = [
  {
    heading: "What this is",
    body: "A self-guided programme of short sessions, daily check-ins and grounding tools. " +
          "It is not therapy, and it does not diagnose or treat anything.",
  },
  {
    heading: "What decides what you see",
    body: "A set of fixed safety rules, run against your own answers. Not a model, and not " +
          "a person watching. The rules can pause or stop a session, and they always say why.",
  },
  {
    heading: "What stays yours",
    body: "You can see everything the companion remembers and delete any of it. You choose " +
          "what is shared and can withdraw that at any time.",
  },
  {
    heading: "What this is not",
    body: "Not emergency care, and not monitored in real time. If you are in danger, 988 " +
          "and 911 are the right call, and they work whether or not Steady does.",
  },
];

export default async function WelcomePage() {
  await requireMember();
  return (
    <MemberPage
      title="Before you start"
      lede="Four things worth knowing. It takes about a minute, and you can come back to it."
    >
      <ol className="space-y-4">
        {SCOPE.map((s, i) => (
          <li key={s.heading} className="rounded-3xl border border-ground/10 bg-linen p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-olive">
              {i + 1} of {SCOPE.length}
            </p>
            <h2 className="mt-1 font-medium text-ground">{s.heading}</h2>
            <p className="measure mt-1 text-ground/90">{s.body}</p>
          </li>
        ))}
      </ol>

      {/* The demonstration boundary, in the member's own flow rather than only
          on the public site. §26's shared acceptance: "the current
          demonstration boundary remains visible." */}
      <p className="measure mt-6 rounded-3xl border border-ground/10 bg-ivory p-5 text-sm text-olive">
        {BOUNDARY.demoData}
      </p>

      {/* One dominant action (§26 member acceptance). */}
      <Link
        href="/app/today"
        className="mt-8 block w-full rounded-full bg-ground px-6 py-4 text-center text-lg font-medium text-ivory transition-colors hover:bg-ground/90"
      >
        Continue
      </Link>
      <p className="mt-3 text-center text-sm">
        <Link href="/crisis" className="text-state-info underline">
          I need support right now
        </Link>
      </p>
    </MemberPage>
  );
}
