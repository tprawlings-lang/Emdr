import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { FAQ } from "@/lib/site/faq";
import { BOUNDARY } from "@/lib/site/registry";

export const metadata = {
  title: "Questions and answers — Steady",
  description: "Audience-filtered answers about the platform, clinical boundaries, organizations, payers, security, access, and evidence.",
};

const VERDICT_STYLE: Record<string, string> = {
  "Yes": "bg-safe/20 text-ground border-safe/40",
  "No": "bg-support/15 text-support-deep border-support/40",
  "Not yet": "bg-pause-soft text-ground border-pause/50",
  "In the fabricated demo only": "bg-moss/50 text-ground border-sage/60",
};

// FAQ (Redesign handoff §13, §14). Every answer leads with its verdict, and the
// copy guard holds this file to the same claims rules as the pages — an FAQ is
// where a bounded claim most easily becomes a confident one.
export default function FaqPage() {
  return (
    <PublicPage
      eyebrow="Questions"
      title="Questions and answers"
      lede="Grouped by who is asking. Every answer starts with the direct answer, and the ones with legal, clinical, or security consequence carry a review date and an owner."
    >
      <div className="mt-8"><BoundaryNote /></div>

      <nav aria-label="Question groups" className="mt-8 flex flex-wrap gap-2">
        {FAQ.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="rounded-full border border-ground/20 px-3 py-1 text-sm text-ground">
            {g.title}
          </a>
        ))}
      </nav>

      {FAQ.map((group) => (
        <section key={group.id} id={group.id} className="mt-12 scroll-mt-8">
          <h2 className="font-serif text-2xl font-medium text-ground">{group.title}</h2>
          <p className="mt-1 text-sm text-olive">{group.blurb}</p>
          <dl className="mt-4 space-y-3">
            {group.items.map((item) => (
              <div key={item.q} data-testid="faq-item" className="rounded-2xl border border-ground/10 bg-linen/40 px-5 py-4">
                <dt className="font-medium text-ground">{item.q}</dt>
                <dd className="mt-2">
                  <span
                    data-testid="faq-verdict"
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[item.verdict]}`}
                  >
                    {item.verdict}
                  </span>
                  <p className="mt-2 text-sm text-ground/80">{item.a}</p>
                  <p className="mt-2 flex flex-wrap gap-x-4 text-xs text-olive">
                    {item.link && (
                      <Link href={item.link.href} className="underline">{item.link.label} →</Link>
                    )}
                    {item.lastReviewed && <span>Last reviewed {item.lastReviewed}</span>}
                    {item.owner && <span>Owner: {item.owner}</span>}
                  </p>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section className="mt-12 rounded-2xl border border-support/30 bg-support/5 px-6 py-5">
        <h2 className="font-serif text-2xl font-medium text-ground">Need help right now?</h2>
        <p className="mt-2 text-sm text-ground/80">{BOUNDARY.crisis}</p>
        <Link href="/crisis" className="mt-3 inline-block text-sm font-medium text-ground underline">
          Immediate help resources →
        </Link>
      </section>
    </PublicPage>
  );
}
