import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { readServiceStatus, type FunctionState } from "@/lib/site/service-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service status — Steady" };

// Degraded service (§26: "/status/degraded — Use safe fallback — available and
// blocked functions — Open grounding").
//
// Not the AccessPage shell: this one is a list rather than a single message,
// and its primary action depends on what is actually down. It keeps the same
// two rules — one clear way forward, and crisis reachable from it.
//
// Every row is measured. A status page of hand-written "operational" rows is a
// claim about a system by someone who was not looking at it, which is the
// notification-truth defect wearing a different hat.

const STATE: Record<FunctionState, { label: string; glyph: string; cls: string }> = {
  available: { label: "Available", glyph: "◆", cls: "text-state-safe" },
  degraded: { label: "Reduced", glyph: "◐", cls: "text-state-caution" },
  blocked: { label: "Not available", glyph: "○", cls: "text-state-support" },
};

export default async function DegradedStatusPage() {
  const status = await readServiceStatus();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Wordmark className="text-3xl" />

      <h1 className="type-identity mt-8 text-3xl font-medium text-ground">
        {status.degraded ? "Some things aren't working" : "Everything is working"}
      </h1>
      <p className="measure mt-3 text-ground/90">
        {status.degraded
          ? "What you can still do, and what is unavailable right now. Grounding and crisis support do not depend on anything that can fail here."
          : "Checked just now. Grounding and crisis support do not depend on anything that can fail here, so they are listed first and are always open."}
      </p>

      <ul className="mt-8 divide-y divide-ground/10 rounded-3xl border border-ground/10 bg-linen">
        {status.functions.map((f) => {
          const s = STATE[f.state];
          return (
            <li key={f.name} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ground">
                  {f.name}
                  {f.alwaysAvailable && (
                    <span className="ml-2 text-xs font-normal text-olive">always open</span>
                  )}
                </p>
                {/* Colour never carries the state alone: a glyph and a word. */}
                <p className={`text-sm font-medium ${s.cls}`}>
                  <span aria-hidden>{s.glyph}</span> {s.label}
                </p>
              </div>
              <p className="measure mt-1 text-sm text-olive">{f.detail}</p>
            </li>
          );
        })}
      </ul>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/app/ground"
          className="rounded-full bg-app-ink px-7 py-3 font-medium text-app-surface transition-opacity hover:opacity-90"
        >
          Open grounding
        </Link>
        <Link
          href="/crisis"
          className="rounded-full border border-ground/25 px-7 py-3 font-medium text-ground transition-colors hover:bg-ground/5"
        >
          Crisis support
        </Link>
      </div>

      <p className="mt-8 border-t border-ground/10 pt-4 font-mono text-xs text-olive">
        checked {status.checkedAt}
      </p>
    </main>
  );
}
