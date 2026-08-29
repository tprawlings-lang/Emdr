import Link from "next/link";
import type { Envelope, PresentationState } from "@/lib/presentation/envelope";
import { hasData } from "@/lib/presentation/envelope";

// Rendering §30.8's presentation states.
//
// The table in §30.8 gives each state a required display and an action rule.
// This component is that table, so a page cannot render six of the eight and
// leave the other two looking like a blank screen.
//
// The distinction it exists to protect: an EMPTY result and a FAILED projection
// must not look alike. Empty is good news. Failed is a user working from
// nothing while believing they are up to date. A page that maps over an array
// shows the same blank box for both, silently — and silence is what makes that
// class of defect dangerous rather than merely untidy.
//
// Two states are safety states and fail closed. Neither withdraws support:
// grounding and crisis stay on screen, because §1 requires them to survive "a
// write, subscription, sync, or service failure" — which is precisely when they
// are most needed.

const STYLE: Record<PresentationState, { cls: string; glyph: string; label: string }> = {
  loading:            { cls: "border-ground/10 bg-linen",                      glyph: "◌", label: "Loading" },
  ready:              { cls: "border-ground/10 bg-linen",                      glyph: "◆", label: "Ready" },
  empty:              { cls: "border-state-safe/40 bg-state-safe-bg/50",       glyph: "◇", label: "Nothing here" },
  stale:              { cls: "border-state-caution/40 bg-state-caution-bg/50", glyph: "◷", label: "Out of date" },
  partial:            { cls: "border-state-caution/40 bg-state-caution-bg/40", glyph: "◐", label: "Incomplete" },
  permission_denied:  { cls: "border-state-unknown/40 bg-state-unknown-bg/60", glyph: "○", label: "No access" },
  projection_failed:  { cls: "border-state-support/40 bg-state-support-bg/50", glyph: "▲", label: "Could not load" },
  policy_unavailable: { cls: "border-state-support/40 bg-state-support-bg/50", glyph: "▲", label: "Sessions paused" },
  audit_unavailable:  { cls: "border-state-support/40 bg-state-support-bg/50", glyph: "▲", label: "Actions unavailable" },
};

/** Who is reading this surface.
 *
 *  "person" means someone whose own care is on the screen — every member
 *  surface, and the clinician ones, where the subject is present in the room
 *  or one message away. "operations" means an aggregate surface: an
 *  organization or payer analyst reading a population. Nobody's care is on the
 *  screen and no individual is present.
 *
 *  It defaults to "person" so a surface that forgets to say keeps the support
 *  paths. That is the safe direction to be wrong in. */
export type Audience = "person" | "operations";

/** Support, rendered in every non-ready state on a person-facing surface.
 *
 *  Not conditional on the STATE, and never smaller because something failed —
 *  there is no failure this system can have in which the way out narrows.
 *
 *  It is conditional on the AUDIENCE, which is a different question and one
 *  this component originally got wrong: an organization capacity screen
 *  rendering `partial` offered its analyst "Grounding" and "Crisis support".
 *  Those links are for a person in distress. On an aggregate surface there is
 *  no such person — the screen is a count of a population — so the links are
 *  noise at best, and at worst they hand an aggregate role a route onto a
 *  member surface, which is the boundary the whole role exists to hold. */
function SupportPaths() {
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <Link href="/app/ground" className="text-state-info underline">Grounding</Link>
      <Link href="/crisis" className="text-state-info underline">Crisis support</Link>
    </p>
  );
}

export function StateNotice<T>({
  envelope, title, audience = "person",
}: { envelope: Envelope<T>; title?: string; audience?: Audience }) {
  const s = STYLE[envelope.state];
  const e = envelope;
  return (
    <div role={e.state === "ready" ? undefined : "status"} className={`rounded-3xl border p-5 ${s.cls}`}>
      <p className="flex items-center gap-2 font-semibold text-ground">
        <span aria-hidden>{s.glyph}</span>
        {title ?? s.label}
      </p>
      {e.reason && <p className="mt-1 text-sm text-ground/90">{e.reason}</p>}

      {/* §30.8 stale: "Last good value plus exact refresh time and stale reason." */}
      {e.state === "stale" && e.staleSince && (
        <p className="mt-1.5 text-sm text-olive">
          Last current at {e.staleSince}. Decisions that need up-to-date information are paused
          until this refreshes.
        </p>
      )}

      {/* §30.8 partial: "Show present values and list missing sources." Named,
          because a caveat that does not say what is missing is not an
          explanation — and §30.8 also forbids computing a clean total from
          incomplete inputs, which a reader can only check if they know. */}
      {e.state === "partial" && e.missing && e.missing.length > 0 && (
        <div className="mt-2">
          <p className="text-sm font-medium text-ground">Missing sources</p>
          <ul className="mt-1 space-y-0.5">
            {e.missing.map((m) => (
              <li key={m.source} className="text-sm text-olive">
                {m.source} — {m.reason}
                {m.lastGoodAt && <span className="text-olive/80"> (last good {m.lastGoodAt})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* §30.8 failed: "Show retry and safe fallback; log correlation ID
          privately." The id is shown so a user can quote it; the detail behind
          it is not. */}
      {e.state === "projection_failed" && (
        <p className="mt-1.5 text-xs text-olive">Reference {e.correlationId}</p>
      )}

      {/* Every state that is not ready keeps the way out visible — for the
          reader who might need one. See SupportPaths. */}
      {e.state !== "ready" && audience === "person" && <SupportPaths />}

      {/* Provenance. §8.3 requires it on the projection; showing it is what
          lets a reviewer tell a stale screen from a fresh one without asking. */}
      <p className="mt-3 border-t border-ground/10 pt-2 font-mono text-xs text-olive">
        {e.meta.schemaVersion} · generated {e.meta.generatedAt} · policy {e.meta.policyVersion}
      </p>
    </div>
  );
}

/** Render data when the envelope carries it, the state notice otherwise.
 *
 *  The signature is the enforcement: `children` receives the unwrapped data, so
 *  a page cannot reach the data without going through the state check. */
export function EnvelopeView<T>({
  envelope, children, title, audience = "person",
}: {
  envelope: Envelope<T>;
  children: (data: T) => React.ReactNode;
  title?: string;
  audience?: Audience;
}) {
  if (!hasData(envelope)) return <StateNotice envelope={envelope} title={title} audience={audience} />;
  return (
    <>
      {/* Stale and partial carry data AND a caveat. Showing the data without
          the caveat is the "clean chart hiding incomplete data" §31.6 blocks a
          release for. */}
      {envelope.state !== "ready" && (
        <div className="mb-4">
          <StateNotice envelope={envelope} title={title} audience={audience} />
        </div>
      )}
      {children(envelope.data)}
    </>
  );
}
