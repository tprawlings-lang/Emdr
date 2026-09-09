import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Callout, SummaryCards } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import {
  SIGNALS, OPERATIONAL_REVIEW, unanswerable, FORBIDDEN_FIELD_NAME,
} from "@/lib/telemetry/catalog";
import { signalCounts, recentSignals } from "@/lib/telemetry/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Telemetry — Steady Review" };

// The telemetry screen (handoff 06 §31.7, Wave 6 hardening).
//
// §31.3's definition of done asks for something unusual: "telemetry proves the
// screen can be used without capturing sensitive free text". That is a claim
// about what the product CANNOT record, and no amount of dashboard proves it —
// a chart of what was collected says nothing about what could have been. So
// this screen shows the CATALOG first: the nine signals §31.7 names, the fields
// each one may carry, and the kind of each field. A kind is what makes the
// claim checkable, because a sentence does not match a code.
//
// THEN IT SHOWS THE COUNTS, INCLUDING THE ZEROS, AND SAYS WHICH KIND OF ZERO.
// A signal at zero because nobody used the screen and a signal at zero because
// nothing records it are the same number and completely different findings. The
// catalog declares where each signal is recorded from, so this screen can tell
// a reader which one they are looking at instead of leaving them to assume.
//
// AND IT ANSWERS THE FOUR QUESTIONS, or says it cannot. §31.7's closing
// paragraph asks whether users reached the right action, whether evidence was
// available, whether the data was current, and whether any role saw more than
// it needed. A question whose signals have all never fired is a question this
// product cannot currently answer, and that belongs on the screen rather than
// in somebody's head.

const KIND_MEANING: Record<string, string> = {
  code: "a token from a fixed vocabulary — lower case, digits and underscores, no spaces",
  role: "an account role, in the same shape as a code",
  ref: "an identifier of something that is not a person — a metric, a cohort version, a filter hash",
  count: "a whole number, never negative",
  duration_ms: "elapsed milliseconds",
  age_s: "age in seconds",
};

export default async function TelemetryPage() {
  await requireReviewAccess();

  const counts = await signalCounts();
  const recent = await recentSignals(15);
  const recorded = new Set(Object.entries(counts).filter(([, n]) => n > 0).map(([s]) => s));

  const instrumented = SIGNALS.filter((s) => s.recordedFrom.length > 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <ReviewPage
      title="Telemetry"
      lede="What this product measures about itself, and what it cannot measure about anybody."
    >
      <SummaryCards
        cards={[
          { label: "Signals declared", value: String(SIGNALS.length), detail: "the handoff names nine" },
          {
            label: "Signals with a call site",
            value: `${instrumented.length} of ${SIGNALS.length}`,
            detail: "the rest have no surface that produces them yet",
          },
          { label: "Rows recorded", value: String(total), detail: "in this environment" },
        ]}
      />

      <Callout tone="info" label="Why the fields are typed">
        Every field below has a kind, and a kind is a shape rather than a
        description. A sentence does not match a code, so a caller that tries to
        attach somebody&apos;s own words to a signal is refused when it records
        rather than found in a review afterwards. No signal declares a field
        that names a person, and the table has no column that could hold one.
      </Callout>

      <Panel
        title="The catalog"
        footnote="Signal names, purposes and privacy rules are the handoff's, unchanged. The fields and their kinds are this product's, and are what make the privacy rule enforceable."
      >
        <div className="space-y-4">
          {SIGNALS.map((s) => {
            const n = counts[s.name] ?? 0;
            const noSurface = s.recordedFrom.length === 0;
            return (
              <div key={s.name} className="rounded-xl border border-ground/10 bg-app-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <code className="text-sm font-semibold">{s.name}</code>
                  <span className="text-xs text-ground/60">
                    {noSurface
                      ? "no surface records this yet"
                      : n === 0
                        ? "recorded from a surface, never fired here"
                        : `${n} recorded`}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ground/80">{s.purpose}</p>
                <p className="mt-1 text-xs text-ground/70">
                  <span className="font-semibold">Privacy rule:</span> {s.privacyRule}
                </p>
                <dl className="mt-3 space-y-1">
                  {s.fields.map((f) => (
                    <div key={f.name} className="grid gap-1 text-xs sm:grid-cols-[12rem_1fr] sm:gap-3">
                      <dt><code>{f.name}</code> <span className="text-ground/50">({f.kind})</span></dt>
                      <dd className="text-ground/70">{KIND_MEANING[f.kind]}</dd>
                    </div>
                  ))}
                </dl>
                {s.recordedFrom.length > 0 && (
                  <p className="mt-2 text-xs text-ground/60">
                    Recorded from{" "}
                    {s.recordedFrom.map((f) => <code key={f} className="mr-2">{f}</code>)}
                  </p>
                )}
                {s.deviation && (
                  <p className="mt-2 rounded-lg bg-moss/40 p-3 text-xs text-ground/80">
                    <span className="font-semibold">Not carried here:</span> {s.deviation}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="Operational review"
        footnote="The four questions an operational review is asked to answer, each with the signals behind it."
      >
        <div className="space-y-3">
          {OPERATIONAL_REVIEW.map((q) => {
            const missing = unanswerable(q, recorded);
            const answerable = missing.length < q.answeredBy.length;
            return (
              <div key={q.question} className="rounded-xl border border-ground/10 bg-app-surface p-4">
                <p className="text-sm font-semibold">{q.question}</p>
                <p className="mt-1 text-xs text-ground/70">
                  Answered by{" "}
                  {q.answeredBy.map((s) => <code key={s} className="mr-2">{s}</code>)}
                </p>
                <p className="mt-2 text-xs text-ground/80">
                  {answerable
                    ? missing.length === 0
                      ? "Every signal behind this question has fired in this environment."
                      : `Partly answerable here. No rows yet for ${missing.join(", ")}.`
                    : "Not answerable in this environment. None of its signals has fired."}
                </p>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="What has actually been recorded"
        footnote="Field values only. There is no person to resolve on any of these rows, by construction."
      >
        {recent.length === 0 ? (
          <p className="text-sm text-ground/70">
            Nothing recorded in this environment yet. Reaching a decision surface or
            completing a queue row writes the first rows.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-ground/60">
                <tr>
                  <th scope="col" className="px-3 py-2">Signal</th>
                  <th scope="col" className="px-3 py-2">Actor role</th>
                  <th scope="col" className="px-3 py-2">Fields</th>
                  <th scope="col" className="px-3 py-2">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={`${r.signal}-${r.createdAt}-${i}`} className={i % 2 === 1 ? "bg-moss/40" : ""}>
                    <td className="px-3 py-2"><code className="text-xs">{r.signal}</code></td>
                    <td className="px-3 py-2 text-xs">{r.actorRole ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-ground/70">
                      {Object.keys(r.fields).length === 0
                        ? "—"
                        : Object.entries(r.fields).map(([k, v]) => `${k}=${v}`).join(" · ")}
                    </td>
                    <td className="px-3 py-2 text-xs text-ground/60">{r.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="What no signal may name">
        <p className="text-sm text-ground/80">
          A field whose name matches any of these is refused by the catalog,
          whatever its kind — the two things kept out of every row are a
          person&apos;s identity and a person&apos;s words:
        </p>
        <p className="mt-2 break-words text-xs text-ground/70">
          <code>{FORBIDDEN_FIELD_NAME.source.replace(/\|/g, " · ")}</code>
        </p>
      </Panel>
    </ReviewPage>
  );
}
