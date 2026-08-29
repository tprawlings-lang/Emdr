import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { data } from "@/lib/data";
import { MemberPage } from "@/components/member/MemberPage";
import { buildGateView, assertGateSafe, type GatePhase } from "@/lib/member/gate-view";
import { hasData } from "@/lib/presentation/envelope";

export const dynamic = "force-dynamic";
export const metadata = { title: "Safety check — Steady" };

// The deterministic safety gate (Web GUI handoff §26, §30.7, gate_view.v7).
//
// This surface existed only inside SessionPlayer's `hardstop` phase — a branch
// of a 1000-line client component, reachable by no URL, with no way for a
// member to return to it and no way for anyone to link to it. §26 makes it a
// screen: "/app/session/:id/safety — Reach support and understand the stop."
//
// Everything here is deliberately plain. §9.1's rule for a safety stop is that
// it carries weight "through contrast and typography", not through alarm
// colour — a member reaching this screen is already activated, and red is the
// wrong physiological signal to add. No apology either: a stop is the system
// working, and copy that treats it as a failure teaches the member to
// experience it as one.

export default async function SafetyGatePage({
  params, searchParams,
}: {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{ phase?: string; rule?: string }>;
}) {
  const { moduleId } = await params;
  const { phase, rule } = await searchParams;
  const user = await requireMember();
  const c = await data();
  const row = (await c.get("SELECT tenant_id FROM users WHERE id = ?", [user.id])) as
    | { tenant_id: string } | undefined;

  // The phase comes from the caller, but is never trusted as free text — an
  // unknown value resolves to the more protective state rather than falling
  // through to something permissive.
  const known: GatePhase[] = ["pause", "block", "responded", "re_entry"];
  const resolved = known.includes(phase as GatePhase)
    ? (phase as Exclude<GatePhase, "continue">)
    : "block";

  const envelope = buildGateView({
    phase: resolved,
    ruleId: rule && /^[A-Z]-\d{2}$/.test(rule) ? rule : "S-04",
    tenantId: row?.tenant_id ?? "",
  });
  const gate = hasData(envelope) ? assertGateSafe(envelope.data) : null;

  return (
    <MemberPage layer="actions" title="Support before we continue">
        {gate ? (
          <>
            <div className="rounded-3xl border border-state-support/30 bg-state-support-bg p-7">
              {/* Weight through typography and contrast, never alarm colour.
                  The mockup (p56) draws this card in the pale rose tint, and
                  that is what state-support-bg is: a verified 4.5:1 ground for
                  the text on it, not a red. The rule the note protects — no
                  alarm colour, no flashing, no urgency styling — still holds. */}
              <p className="text-xs font-semibold uppercase tracking-widest text-olive">
                {gate.headline}
              </p>
              <h2 className="type-identity mt-3 text-3xl leading-snug text-ground">
                Let&apos;s make sure you have support right now.
              </h2>
              <p className="measure mt-3 text-ground/90">{gate.explanation}</p>

              {/* §30.7's authority statement. The member is told what did not
                  make this decision, because a member who thinks a model
                  stopped them will argue with it or work around it. */}
              <p className="measure mt-4 border-t border-ground/10 pt-4 text-sm text-ground/90">
                {gate.authorityNote}
              </p>

              {/* Support first, and the option that needs nothing from us is
                  the most prominent one. */}
              <div className="mt-6 space-y-3">
                {gate.options.map((o, i) => (
                  <Link
                    key={o.id}
                    href={o.href}
                    className={
                      i === 0
                        ? "block w-full rounded-full bg-ground px-6 py-4 text-center text-lg font-medium text-ivory"
                        : "block w-full rounded-full border border-ground/25 px-6 py-3 text-center font-medium text-ground hover:bg-ground/5"
                    }
                  >
                    {o.label}
                  </Link>
                ))}
              </div>

              {/* Re-entry is a NEW evaluation, and the label says so. §27.5:
                  not "a clinician button that clears history" — and not a
                  member one either. */}
              {gate.recheckAvailable && (
                <Link
                  href={`/app/session/${moduleId}?recheck=1`}
                  className="mt-3 block w-full rounded-full border border-ground/25 px-6 py-3 text-center font-medium text-ground hover:bg-ground/5"
                >
                  I am safe now — check again
                </Link>
              )}
            </div>

            {/* §9.2's member-side equivalent of the evidence drawer: the rule
                and its version, available without being led with. */}
            <details className="mt-5">
              <summary className="cursor-pointer text-sm text-state-info underline">
                Why this appeared
              </summary>
              <p className="measure mt-2 text-sm text-olive">
                A direct answer met fixed rule{" "}
                <span className="font-mono">{gate.rule.id}</span>, under policy version{" "}
                <span className="font-mono">{gate.rule.version}</span>. The answer and the rule
                are both on your record, and your care team sees the same result you do.
              </p>
            </details>
          </>
        ) : (
          // The gate itself failing must not remove the reason it exists.
          <div className="rounded-3xl border border-state-support/30 bg-state-support-bg p-7">
            <h2 className="type-identity text-3xl text-ground">Support is available now</h2>
            <p className="measure mt-3 text-ground/90">
              Something went wrong loading this screen. That does not change what is
              available to you.
            </p>
            <a
              href="tel:988"
              className="mt-6 block w-full rounded-full bg-ground px-6 py-4 text-center text-lg font-medium text-ivory"
            >
              Call or text 988
            </a>
          </div>
        )}
    </MemberPage>
  );
}
