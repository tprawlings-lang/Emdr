import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { EVIDENCE_METHOD, EVIDENCE_SOFTWARE, EVIDENCE_NEEDED, EVIDENCE_BLS, type EvidenceItem } from "@/lib/site/trust";

export const metadata = {
  title: "Evidence and validation — Steady",
  description: "Evidence for the EMDR method, evidence for Steady's software behavior, and the evidence that does not exist yet.",
};

function EvidenceList({ items, runnable }: { items: EvidenceItem[]; runnable?: boolean }) {
  return (
    <ul className="mt-4 space-y-3">
      {items.map((e) => (
        <li key={e.claim} data-testid="evidence-item" className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
          <p className="font-medium text-ground">{e.claim}</p>
          <p className="mt-1 text-sm text-ground/80">{e.support}</p>
          {runnable && e.runnable && (
            <p className="mt-2 text-xs text-olive">
              Run it yourself: <code className="rounded bg-ivory px-1.5 py-0.5 text-[11px]">{e.runnable}</code>
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
export default function EvidencePage() {
  return (
    <PublicPage
      eyebrow="Evidence"
      title="What is proven, what is simulated, and what is still needed"
      lede="Evidence about the EMDR method and evidence about Steady are different things. They are kept in separate sections here so neither can be mistaken for the other."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">Evidence for the method</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Published research and clinical guidelines describe EMDR <strong>delivered by trained
          clinicians</strong>. Steady does not claim that evidence as its own.
        </p>
        <EvidenceList items={EVIDENCE_METHOD} />
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">Evidence for Steady&rsquo;s software</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          What can be demonstrated about the system itself, with the command that demonstrates
          it. These are claims about software behavior — determinism, isolation, replay,
          accessibility — and not claims about clinical effect.
        </p>
        <EvidenceList items={EVIDENCE_SOFTWARE} runnable />
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">Evidence still needed</h2>
        <p className="mt-2 max-w-3xl text-ground/80">
          Named here rather than omitted. Each is a real gap between what Steady is and what it
          would need to be before anyone uses it in care.
        </p>
        <EvidenceList items={EVIDENCE_NEEDED} />
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl font-medium text-ground">BLS Part 6</h2>
        <EvidenceList items={EVIDENCE_BLS} runnable />
      </section>

      <section className="mt-12 rounded-2xl border border-pause/50 bg-pause-soft px-6 py-5">
        <h2 className="font-serif text-2xl font-medium text-ground">How to read a claim on this site</h2>
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
