// The review console shell (Web GUI handoff §26, "Review and administration").
//
// The four consoles each opened with their own header at their own width — one
// at max-w-4xl, three at max-w-5xl, each with a different subtitle convention
// and one with a stray top margin. Individually invisible; together it is why
// moving between them feels like moving between four tools.
//
// §26 gives review a role of its own, so the shell states what every one of
// these screens has in common: this is a review surface, the thing being
// reviewed is a decision the product already made, and the record is what is
// authoritative rather than the page.

export function ReviewPage({
  title, lede, wide = true, children,
}: {
  title: string;
  lede?: string;
  /** Narrower for a console that is mostly prose and forms. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className={`mx-auto ${wide ? "max-w-5xl" : "max-w-4xl"} px-6 py-10`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-olive">
        Review and administration
      </p>
      <h1 className="mt-1 type-display text-3xl font-medium text-ground">{title}</h1>
      {lede && <p className="measure mt-2 text-olive">{lede}</p>}
      <div className="mt-8">{children}</div>
    </main>
  );
}
