import type { HistoryDay } from "@/lib/member/history";

// What the member has done (Presentation Layer Handoff §1.4, §8).
//
// Component contract: receives completed practice refs. Must never receive
// dates-as-streak, counts, or charts.
//
// It replaced two trend charts of PCL-5 and ITQ scores. The pattern is Wysa's,
// and the handoff names why it fits: "the member never fills out a log; the
// system assembles one from what they actually did." Someone gets a record
// without being asked to produce one, which matters when the effort of
// self-reporting is itself the barrier.
//
// Why there is no streak, stated here because it is the thing most likely to be
// requested later: a streak is a score with a friendlier name. It creates the
// same performance pressure, and it turns a missed day — often a bad day, the
// day this product exists for — into a visible failure shown on return. Days
// with nothing in them are absent rather than empty, for the same reason a
// narrowed day shows no locked cards.

const KIND_LABEL: Record<HistoryDay["items"][number]["kind"], string> = {
  session: "Session",
  practice: "Practice",
  lesson: "Read",
};

export function HistoryStrip({ days }: { days: HistoryDay[] }) {
  if (days.length === 0) {
    return (
      <p className="measure mt-3 text-sm text-olive">
        Nothing here yet. This fills in on its own as you use Steady — there is nothing to
        log.
      </p>
    );
  }

  return (
    <>
      <ul className="mt-4 space-y-3" data-testid="history-strip">
        {days.map((d) => (
          <li
            key={d.day}
            data-testid="history-day"
            className="rounded-3xl border border-ground/10 bg-linen px-5 py-4"
          >
            <p className="text-sm text-olive">{formatDay(d.day)}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {d.items.map((i) => (
                <li
                  key={`${i.kind}:${i.id}`}
                  className="rounded-full border border-ground/15 bg-ivory px-3 py-1 text-sm"
                >
                  <span className="text-olive">{KIND_LABEL[i.kind]}</span> {i.name}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <p className="measure mt-3 text-sm text-olive">
        Days you didn&rsquo;t use Steady simply aren&rsquo;t here, and nothing is being
        counted.
      </p>
    </>
  );
}

/** A readable date. Never a relative "3 days ago" — relative dates invite the
 *  arithmetic of how long it has been, which is a streak by another route. */
function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}
