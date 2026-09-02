import Link from "next/link";
import { ReviewPage, REVIEW_SCREENS } from "@/components/clinical/ReviewPage";
import { Panel } from "@/components/app/surfaces";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review — Steady" };

// Review home (§26: "Review home — /review — See open decisions and release
// gates — Review queue — Open gate").
//
// The console had four screens and no front door: /review resolved to nothing,
// so the rail's Overview layer pointed at a 404 and the guard failed the build,
// which is exactly what it is for.
//
// What this screen does NOT do is show a review queue. §26 asks for one, and
// there is no queue to show: scoped access requests, release sign-offs and
// clinical language approvals are not modelled as records anywhere in this
// deployment. A queue rendered empty here would be the notification-truth
// defect again — an empty list implying a working channel — so the screen says
// which four questions it can answer and which nine it cannot, by name.

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

      <Panel
        title="Not built"
        className="mt-6"
        footnote="Named rather than omitted: a reviewer who cannot tell 'not built' from 'not found' assumes the first and stops looking."
      >
        <ul className="space-y-1.5">
          {ATLAS.filter((a) => !built.has(a.route)).map((a) => (
            <li
              key={a.route}
              className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5 text-sm"
            >
              <span className="text-ground">{a.question}</span>
              <span className="font-mono text-xs text-olive">{a.route}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="The review queue" className="mt-6">
        <p className="measure text-ground/90">
          This screen is meant to carry a queue of open decisions and release gates. There
          is no such queue: scoped access requests, release sign-offs and clinical language
          approvals are not recorded as anything in this deployment, so there is nothing to
          order or assign.
        </p>
        <p className="measure mt-3 text-sm text-olive">
          An empty queue rendered here would say a channel exists and happens to be quiet,
          which is a different and false statement. It needs a request record with a
          requester, a scope, an expiry and an approver before it can be listed.
        </p>
      </Panel>
    </ReviewPage>
  );
}
