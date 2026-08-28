import { MemberNav } from "./MemberNav";

// The member page shell (Web GUI handoff §26, §12.3).
//
// Nine member screens repeated the same four lines of chrome. That is how a
// measure cap, a heading role or a nav slips on one screen and nobody notices:
// the drift is invisible until someone opens two pages side by side.
//
// §12.3's member rules live here rather than in each page — the identity serif
// for page identity, the ~60 character measure on the lede, and body copy that
// never drops below the 17px floor the type system sets globally.

export function MemberPage({
  title, lede, children, wide = false,
}: {
  title: string;
  /** One sentence. If a screen needs two, the screen is doing two jobs. */
  lede?: string;
  children: React.ReactNode;
  /** Only for screens that genuinely need the room — a list of sessions, not
   *  a page of prose. */
  wide?: boolean;
}) {
  return (
    <>
      <MemberNav />
      <main className={`mx-auto ${wide ? "max-w-4xl" : "max-w-3xl"} px-6 py-10`}>
        <h1 className="type-identity text-3xl text-ground">{title}</h1>
        {lede && <p className="measure mt-2 text-olive">{lede}</p>}
        <div className="mt-8">{children}</div>
      </main>
    </>
  );
}
