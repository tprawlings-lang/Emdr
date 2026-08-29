import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { MEMBER_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";

// The member page shell (Web GUI handoff §26, §12.3, and the twenty page
// examples in §28).
//
// This used to render its own chrome: a seven-item pill nav, a centred column,
// a serif h1. That was built from the handoff's text without opening its
// mockups, and it is not what any of the twenty examples draw. They all draw
// one frame — bar, rail, title, standing line — so the frame moved into
// AppShell and this became the member's way of asking for it.
//
// What it still owns is the member-specific part of §12.3: one sentence of
// lede at the ~60 character measure, and the decision about which of §25's
// information layers a given screen belongs to.

export function MemberPage({
  title,
  lede,
  layer = "overview",
  children,
  aside,
}: {
  title: string;
  /** One sentence. If a screen needs two, the screen is doing two jobs. */
  lede?: string;
  /** Which of §25's four layers this screen is. Defaults to the action layer,
   *  because a member screen that has not decided is almost always an
   *  "what do I do now" screen. */
  layer?: RailSlug;
  children: React.ReactNode;
  /** The meaning card beside the content, where a screen has one. */
  aside?: React.ReactNode;
}) {
  return (
    <AppShell
      role="Patient or member"
      title={title}
      active={layer}
      railHref={MEMBER_RAIL}
      accountHref="/app/settings"
      railFooter={
        // Sign out was in the old member header. The frame does not draw one,
        // and a member who cannot leave an account on a shared computer is a
        // privacy problem, not a layout one.
        <form action={logout}>
          <button className="hover:underline">Sign out</button>
        </form>
      }
      aside={aside}
    >
      {lede && <p className="measure -mt-1 mb-6 text-olive">{lede}</p>}
      {children}
    </AppShell>
  );
}
