import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { EVIDENCE_NEEDED } from "@/lib/site/trust";
import {
  EVIDENCE_CLAIMS, claimsFor, EVIDENCE_TYPE_LABEL, type EvidenceClaim,
} from "@/lib/governance/evidence-registry";
import { recordPublication } from "@/lib/governance/claim-usage";

export const metadata = {
  title: "Evidence and validation — Steady",
  description: "Evidence for the EMDR method, evidence for Steady's software behavior, and the evidence that does not exist yet.",
};

// EVERY CLAIM ON THIS PAGE COMES OUT OF THE REGISTRY, and the registry is what
// decides whether it may appear here at all. The page can no longer carry a
// sentence of its own: there is nowhere to put one.
function ClaimList({ claims }: { claims: EvidenceClaim[] }) {
  return (
    <ul className="mt-4 space-y-3">
      {claims.map((c) => (
        <li key={c.claimId} data-testid="evidence-item" className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
          <p className="font-medium text-ground">{c.publicText}</p>
          <p className="mt-1 text-sm text-ground/80">{c.resultSummary}</p>
          {/* WHAT IT CANNOT SUPPORT, on every claim, because a claim with no
              stated limit is one somebody will stretch. The registry refuses to
              resolve a claim that has none. */}
          <p className="mt-1 text-sm text-olive">{c.limitations}</p>
          <p className="mt-2 text-xs text-olive">
            {EVIDENCE_TYPE_LABEL[c.evidenceType]} · about {c.productScope} · reviewed {c.reviewedAt}
          </p>
          {c.sourceIds.some((s) => s.startsWith("npm ")) && (
            <p className="mt-1 text-xs text-olive">
              Run it yourself:{" "}
              {c.sourceIds.filter((s) => s.startsWith("npm ")).map((s) => (
                <code key={s} className="mr-2 rounded bg-ivory px-1.5 py-0.5 text-[11px]">{s}</code>
              ))}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// Evidence page (Redesign handoff §11).
//
// The separation between method evidence and product evidence is the whole
// point of this page. Published EMDR research is real and is about clinicians
// delivering EMDR — presenting it as evidence for Steady would be the single
// most misleading thing this site could do, and it is the exact move the old
// page made by putting trial statistics under the product story.
export default async function EvidencePage() {
  // Resolved for THIS surface, at today's date. An expired claim, one nobody
  // approved, or one approved for the trust page and not this one does not
  // render — and the withheld list below says so rather than the page quietly
  // getting shorter.
  const asOf = new Date().toISOString().slice(0, 10);
  const { shown, withheld } = claimsFor(EVIDENCE_CLAIMS, { surface: "/evidence", asOf });

  // PUBLISHING IS A USE, and the handoff asks for every publication version
  // that used a claim to be recorded. This is that moment: these words, in
  // this version, on this route, from this build. It writes once per version —
  // the render after a deploy, not the one after that — and it cannot fail the
  // page, because the page is public.
  await recordPublication(shown, { surface: "/evidence" });
  const method = shown.filter((c) => c.claimId.startsWith("method."));
  const software = shown.filter((c) => c.claimId.startsWith("software."));
  const bls = shown.filter((c) => c.claimId.startsWith("bls."));

  return (
    <PublicPage
      eyebrow="Evidence"
      title="What is proven, what is simulated, and what is still needed"
      lede="Evidence about the EMDR method and evidence about Steady are different things. They are kept in separate sections here so neither can be mistaken for the other."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Evidence for the method</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Published research and clinical guidelines describe EMDR <strong>delivered by trained
          clinicians</strong>. Steady does not claim that evidence as its own.
        </p>
        <ClaimList claims={method} />
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Evidence for Steady&rsquo;s software</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          What can be demonstrated about the system itself, with the command that demonstrates
          it. These are claims about software behavior — determinism, isolation, replay,
          accessibility — and not claims about clinical effect.
        </p>
        <ClaimList claims={software} />
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">Evidence still needed</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Named here rather than omitted. Each is a real gap between what Steady is and what it
          would need to be before anyone uses it in care.
        </p>
        {/* NOT CLAIMS, so not in the registry. These are the things Steady
            does NOT have, and governing them under claim approval would mean an
            expiring approval could remove a gap from the page — which is the
            one direction this page must never move in. */}
        <ul className="mt-4 space-y-3">
          {EVIDENCE_NEEDED.map((e) => (
            <li key={e.claim} data-testid="evidence-gap" className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
              <p className="font-medium text-ground">{e.claim}</p>
              <p className="mt-1 text-sm text-ground/80">{e.support}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">BLS Part 6</h2>
        <ClaimList claims={bls} />
      </section>

      {withheld.length > 0 && (
        <section className="mt-12 rounded-2xl border border-ground/15 px-6 py-5" data-testid="withheld-claims">
          <h2 className="type-display text-2xl font-medium text-ground">Withheld</h2>
          <p className="mt-2 max-w-3xl text-sm text-ground/80">
            {/* A page that silently gets shorter is how an expiry goes
                unnoticed. It is named, with the reason, and the reason is the
                registry's own words. */}
            {withheld.length} claim{withheld.length === 1 ? "" : "s"} in the registry did not resolve
            for this page today and {withheld.length === 1 ? "is" : "are"} not shown.
          </p>
          <ul className="mt-3 space-y-2">
            {withheld.map((w) => (
              <li key={w.claim.claimId} className="text-sm text-olive">
                <code className="text-xs">{w.claim.claimId}</code> — {w.refusals.join(" ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12 rounded-2xl border border-pause/50 bg-pause-soft px-6 py-5">
        <h2 className="type-display text-2xl font-medium text-ground">How to read a claim on this site</h2>
        <p className="mt-2 text-sm text-ground/80">
          Every capability carries one of four labels: <strong>Working demo</strong> runs in the
          fabricated environment now; <strong>Simulation</strong> demonstrates intended behavior
          without approval for real use; <strong>In review</strong> is built or documented with
          reviewer decisions still open; <strong>Planned</strong> has no active control and no
          product claim. The labels come from a single registry, so two pages cannot disagree
          about the same capability.
        </p>
        <p className="mt-2 text-sm text-ground/80">
          Dated evidence and exact scope are used instead of general labels. Steady does not
          describe itself as compliant, validated, secure, or approved.
        </p>
        <Link href="/trust" className="mt-3 inline-block text-sm font-medium text-ground underline">
          Control status and known gaps →
        </Link>
      </section>
    </PublicPage>
  );
}
