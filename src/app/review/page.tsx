import Link from "next/link";
import { ReviewPage, REVIEW_SCREENS } from "@/components/clinical/ReviewPage";
import { Panel } from "@/components/app/surfaces";
import { listAccessRequests } from "@/lib/review/access";
import { decisionsAt } from "@/lib/review/decisions";
import { reviewableSurfaces, copyVersion } from "@/lib/review/clinical-copy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review — Steady" };

// Review home (§26: "Review home — /review — See open decisions and release
// gates — Review queue — Open gate").
//
// The console had four screens and no front door: /review resolved to nothing,
// so the rail's Overview layer pointed at a 404 and the guard failed the build,
// which is exactly what it is for.
//
// The queue is real now. It was not: scoped access requests, release sign-offs
// and clinical language approvals were not recorded as anything, so this screen
// listed the questions it could not answer rather than rendering an empty list
// that implied a working channel. All three are records in review_decisions
// today, so the counts below are counted rather than assumed — and a zero here
// now means nothing is waiting, which is a claim the screen could not make
// before and can.

/** §26's thirteen review screens, plus handoff 07's planning detail. Some exist; the rest are named rather than
 *  quietly omitted, because a reviewer who cannot tell "not built" from "not
 *  found" will assume the first and stop looking. */
const ATLAS: Array<{ route: string; question: string }> = [
  { route: "/review", question: "See open decisions and release gates" },
  { route: "/review/access", question: "Approve scoped access" },
  { route: "/review/clinical", question: "Review language and flow" },
  { route: "/review/autonomous", question: "Inspect bounded AI path" },
  { route: "/review/bls", question: "Review pacing and stop controls" },
  { route: "/review/testing", question: "Judge release behavior" },
  { route: "/review/safety", question: "Replay fixed scenarios" },
  // Not one of §26's thirteen. Handoff 07 p44 specifies it, and where the two
  // handoffs differ the later one controls.
  { route: "/review/planning", question: "Inspect and challenge a planning signal" },
  { route: "/review/audit", question: "Trace all governed events" },
  { route: "/review/lineage", question: "Trace a screen statement to source" },
  { route: "/review/research", question: "Use approved de-identified data" },
  { route: "/review/release", question: "Record required sign-offs" },
  { route: "/review/demo-data", question: "Reset and verify fabricated data" },
  { route: "/review/status", question: "See health and safe fallback" },
];

export default async function ReviewHome() {
  const built = new Set(REVIEW_SCREENS.map((s) => s.href));
  const unbuilt = ATLAS.filter((a) => !built.has(a.route));

  // Cheap counts only. Release-gate state needs an identity scan and a
  // scenario replay to resolve, and running those on the console's front door
  // would make the most-opened screen the slowest one — so the gate row links
  // out rather than reporting a number this page would have to guess at.
  const pendingRequests = await listAccessRequests();
  const pendingAccess = pendingRequests.filter((r) => !r.decision).length;
  const surfaces = reviewableSurfaces();
  const copyDecisions = await decisionsAt("clinical_language", copyVersion());
  const surfaceCount = surfaces.length;
  const unreviewedCopy = surfaces.filter((s) => copyDecisions.get(s.id)?.decision !== "approved").length;

  return (
    <ReviewPage
      layer="overview"
      here="/review"
      title="Review and administration"
      lede="What this environment can be checked against, and what it cannot. Every claim below is either a screen you can open or a gap named as one."
    >
      <Panel title="Available now">
        <ul className="space-y-2">
          {ATLAS.filter((a) => built.has(a.route) && a.route !== "/review").map((a) => (
            <li key={a.route}>
              <Link
                href={a.route}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3 py-2.5 transition-colors hover:bg-app-accent/40"
              >
                <span className="font-medium text-app-ink">{a.question}</span>
                <span className="font-mono text-xs text-olive">{a.route}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      {unbuilt.length > 0 && (
        <Panel
          title="Not built"
          className="mt-6"
          footnote="Named rather than omitted: a reviewer who cannot tell 'not built' from 'not found' assumes the first and stops looking."
        >
          <ul className="space-y-1.5">
            {unbuilt.map((a) => (
              <li key={a.route} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5 text-sm">
                <span className="text-ground">{a.question}</span>
                <span className="font-mono text-xs text-olive">{a.route}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="The review queue"
        className="mt-6"
        footnote="Counted from the decision record, not from a notification channel. A zero here means nothing is waiting, which is a claim this screen can now actually make."
      >
        <ul className="space-y-2">
          <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3 py-2.5">
            <Link href="/review/access" className="font-medium text-app-ink underline">
              Access requests awaiting a decision
            </Link>
            <span className="tabular-nums text-olive">{pendingAccess}</span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3 py-2.5">
            <Link href="/review/clinical" className="font-medium text-app-ink underline">
              Member-facing surfaces not approved at the current copy version
            </Link>
            <span className="tabular-nums text-olive">
              {unreviewedCopy} of {surfaceCount}
            </span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl px-3 py-2.5">
            <Link href="/review/release" className="font-medium text-app-ink underline">
              Release gates
            </Link>
            <span className="text-olive">
              resolved on the gate screen — each one&rsquo;s state depends on evidence this page does not run
            </span>
          </li>
        </ul>
      </Panel>

    </ReviewPage>
  );
}
