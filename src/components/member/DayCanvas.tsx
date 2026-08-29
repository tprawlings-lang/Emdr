import Link from "next/link";
import type { MemberDay, DayShape } from "@/lib/member/view";
import { DAY_MESSAGE, horizonPosition } from "@/lib/member/view";

// The member's day (Presentation Layer Handoff §4, §7, §8).
//
// Component contract: receives a DayState. Must never receive scores, rule IDs,
// or a track name — and cannot, because MemberDay has no field to hold one.
//
// Two rules shape everything here.
//
//   ABSENT IS ABSENT. The handoff calls this its single most important line:
//   "A locked card is a scoreboard of what you failed to unlock." So this
//   renders what is available and says nothing whatsoever about what is not.
//   There is no greyed card, no padlock, no "unavailable" state, and no count
//   of things withheld — a count would be the scoreboard with the numbers
//   filed off.
//
//   A NARROW DAY IS THE DAY'S WORK, NOT A FAILED CHECK. Every shape is
//   rendered in the same visual register. A narrowed day gets no warning
//   colour, no apology, and no explanation of why — the explanation is where
//   the criteria label leaks back in.

/** The horizon (§7's signature element).
 *
 *  One thin rule at a consistent position on every screen, sitting lower on a
 *  narrow day and higher on an open one. It carries the day's shape without a
 *  number, a colour code, or a label — which is the whole point: the member
 *  reads their day from where the line sits, and there is nothing to compare it
 *  against.
 *
 *  DELIBERATELY STATELESS, and this is the boundary condition the handoff
 *  flags. A single static position per day is a state indicator. The moment it
 *  animates across days, shows history, or can be scrubbed, it becomes a trend
 *  chart and violates Vol 2. There is no prop here that takes a date range, and
 *  that absence is the design rather than an oversight.
 *
 *  Open question the handoff raises and I have not resolved: whether any
 *  persistent state indicator reads as a covert score to a clinical reviewer.
 *  It is worth putting in front of one — the answer is a clinical judgement,
 *  not a design preference. */
export function Horizon({ shape }: { shape: DayShape }) {
  const at = horizonPosition(shape);
  return (
    <div
      className="relative h-14"
      data-testid="horizon"
      data-shape={shape}
      aria-hidden="true"
    >
      <div
        className="absolute left-0 right-0 border-t border-ground/25"
        style={{ top: `${at * 100}%` }}
      />
    </div>
  );
}

/** One practice available today.
 *
 *  Contract: receives a practice ref and its availability. Must never receive a
 *  severity or a reason-for-exclusion — a card that knows why its neighbour is
 *  missing is one edit from displaying it. */
export function PracticeCard({
  id, name, minutes, primary = false,
}: { id: string; name: string; minutes: number; primary?: boolean }) {
  return (
    <Link
      href={`/app/session/${id}`}
      data-testid="practice-card"
      className={`block rounded-3xl border px-5 py-4 transition-colors ${
        primary
          ? "border-ground/25 bg-moss/50 hover:bg-moss"
          : "border-ground/10 bg-linen hover:bg-moss/30"
      }`}
    >
      <p className="type-display text-lg">{name}</p>
      <p className="mt-0.5 text-sm text-olive">About {minutes} minutes</p>
    </Link>
  );
}

/** The day itself. One primary task, everything else secondary (Vol 1 B-6). */
export function DayCanvas({ day }: { day: MemberDay }) {
  const secondary = day.practices.filter((p) => p.id !== day.primary?.id);

  return (
    <section data-testid="day-canvas" data-shape={day.shape} className="mt-6">
      <Horizon shape={day.shape} />

      <p className="type-display measure text-2xl leading-snug text-ground">
        {DAY_MESSAGE[day.messageKey]}
      </p>

      {day.primary && (
        <div className="mt-5">
          <PracticeCard {...day.primary} primary />
        </div>
      )}

      {secondary.length > 0 && (
        <>
          <p className="mt-6 text-sm text-olive">Also open today</p>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {secondary.map((p) => (
              <li key={p.id}>
                <PracticeCard {...p} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* A day with nothing in it is the state most likely to produce
          abandonment (§4), so it is never an empty screen. It routes toward a
          person rather than sitting there. */}
      {day.practices.length === 0 && (
        <div className="mt-5 rounded-3xl border border-ground/15 bg-linen px-5 py-5">
          <p className="measure text-ground">
            There is nothing to work through today. Grounding tools and support are still
            here whenever you want them.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              href="/app/ground"
              className="rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory"
            >
              Grounding
            </Link>
            <Link
              href="/crisis"
              className="rounded-full border border-ground/25 px-5 py-2.5 text-sm font-medium text-ground"
            >
              Talk to someone
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
