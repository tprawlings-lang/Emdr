import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { MemberNav } from "@/components/member/MemberNav";
import { gatePosition, GATE_COPY, completedAnswers, clearProgress } from "@/lib/member/gate";
import { answerGateItemAction, pauseGateAction } from "@/lib/member/gate-actions";
import { finishGateAction } from "@/lib/member/gate-finish";
import { buildMemberDay, DAY_MESSAGE } from "@/lib/member/view";

export const dynamic = "force-dynamic";

// One question per screen (Presentation Layer Handoff §5, Vol 1 B-6).
//
// Not a form. A paced sequence: one item, its answers, a position marker, a way
// back, and a way to pause. Every answer is written the moment it is given, so
// leaving loses nothing and there is no "start over" anywhere in the flow.
//
// No JavaScript. Each step is a form post that redirects to the next, so the
// sequence works before hydration and survives a reload — which is what
// "resumable by default" has to mean for someone on a bad connection at 2am.

export default async function GateStepPage({
  params, searchParams,
}: {
  params: Promise<{ instrumentId: string }>;
  searchParams: Promise<{ i?: string; done?: string; error?: string }>;
}) {
  const user = await requireMember();
  const { instrumentId } = await params;
  const { i, done, error } = await searchParams;

  const pos = await gatePosition({
    userId: user.id,
    instrumentId,
    index: i === undefined ? undefined : Number(i),
  }).catch(() => null);

  if (!pos) redirect("/screening");

  // ---- Completion. §5: "No result screen with a number. The gate terminates
  // in a Day State, not a score." ----
  if (done === "1" && pos.complete) {
    const day = await buildMemberDay(user.id);
    return (
      <>
        <MemberNav />
        <main className="mx-auto max-w-2xl px-6 py-14">
          <h1 className="type-identity text-3xl">{GATE_COPY["gate.done.v1"]}</h1>
          <p className="measure mt-3 text-ground/80">{DAY_MESSAGE[day.messageKey]}</p>

          <form action={finishGateAction} className="mt-8">
            <input type="hidden" name="instrument" value={pos.instrument.id} />
            <button className="rounded-full bg-ground px-6 py-3 font-medium text-ivory">
              Go to today
            </button>
          </form>

          <p className="measure mt-6 text-sm text-olive">
            Your answers go to the care team that reviews them. There is no result to read
            here and nothing to compare yourself against.
          </p>
        </main>
      </>
    );
  }

  const item = pos.instrument.items[pos.index];
  const section = pos.instrument.sections?.find((s) => s.startIndex === pos.index);

  return (
    <>
      <MemberNav />
      <main className="mx-auto max-w-2xl px-6 py-12">
        {/* §5: position, not percentage. "Question 3 of 20" is a place in a
            sequence; "15%" invites the arithmetic of how much is left, which is
            abandonment maths. */}
        <p className="text-sm text-olive" data-testid="gate-position">
          {GATE_COPY["gate.position.v1"](pos.step, pos.total)}
        </p>

        {section && (
          <h2 className="type-display mt-4 text-lg text-olive">{section.heading}</h2>
        )}

        <h1 className="type-identity measure mt-3 text-2xl leading-snug">{item}</h1>

        {error && (
          <p className="mt-4 rounded-2xl border border-ground/20 bg-linen px-4 py-3 text-sm">
            {error}
          </p>
        )}

        {/* One item, one set of answers. Each is its own submit button, so
            answering IS advancing — there is no separate "next" to press, and
            no way to leave an item selected but unrecorded. */}
        <ul className="mt-8 space-y-2">
          {pos.instrument.options.map((opt) => (
            <li key={opt.value}>
              <form action={answerGateItemAction}>
                <input type="hidden" name="instrument" value={pos.instrument.id} />
                <input type="hidden" name="index" value={pos.index} />
                <input type="hidden" name="value" value={opt.value} />
                <button
                  data-testid="gate-option"
                  aria-current={pos.existing === opt.value ? "true" : undefined}
                  className={`w-full rounded-2xl border px-5 py-4 text-left transition-colors ${
                    pos.existing === opt.value
                      ? "border-ground/30 bg-moss"
                      : "border-ground/15 bg-linen hover:bg-moss/40"
                  }`}
                >
                  {opt.label}
                  {pos.existing === opt.value && (
                    <span className="ml-2 text-sm text-olive">your answer</span>
                  )}
                </button>
              </form>
            </li>
          ))}
        </ul>

        {/* §5: an exit affordance on EVERY step, in a consistent position,
            "labeled as a pause, not a quit — the no-guilt close." The wording
            carries as much as the presence: "Quit" tells someone they are
            abandoning something, which in this population is a reason not to
            come back. */}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-ground/10 pt-5">
          {pos.index > 0 ? (
            <Link
              href={`/screening/${pos.instrument.id}?i=${pos.index - 1}`}
              className="text-sm text-olive underline"
            >
              {GATE_COPY["gate.back.v1"]}
            </Link>
          ) : (
            <span />
          )}

          <form action={pauseGateAction}>
            <button data-testid="gate-pause" className="text-sm text-olive underline">
              {GATE_COPY["gate.pause.v1"]}
            </button>
          </form>
        </div>

        {pos.complete && done !== "1" && (
          <p className="mt-6 text-sm text-olive">
            Every question has an answer.{" "}
            <Link href={`/screening/${pos.instrument.id}?done=1`} className="underline">
              Finish
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
