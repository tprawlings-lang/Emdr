import { AppShell, type RailSlug } from "@/components/app/AppShell";
import { MEMBER_RAIL } from "@/lib/app/rails";
import { logout } from "@/lib/actions";
import { MemberShell } from "@/components/experience/MemberShell";
import { memberNavigation } from "@/lib/experience/navigation";
import { memberShellEnabled } from "@/lib/experience/flags";

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

// ONE MEMBER, ONE SHELL — added 24 September, and found by a person clicking.
//
// WHAT IT LOOKED LIKE: signing in as a member landed on Today with a horizontal
// row across the top — Today, Tools, Progress, Care team — and following any
// link from it replaced that with a vertical rail on the left reading Overview,
// Progress, Actions, Evidence. Not a different arrangement of the same
// destinations: DIFFERENT WORDS. A person who pressed "Care team" arrived
// somewhere that no longer had a "Care team" in its navigation, and no way back
// to Today that was visible.
//
// WHY, AND BOTH SIDES WERE RIGHT ONCE. `AppShell` is the Web GUI handoff's
// frame, and §25's information layers are deliberately identical for every
// role. Handoff 09 §3 then gave the MEMBER a different geometry on purpose —
// "Member: Today, Tools, Progress; Account; persistent Get support" — because a
// person on a phone at night is not running a console. That shell was built and
// wired to exactly one route. Thirty-one others kept the old frame.
//
// AND THE LAYOUT WAS THE SMALLER HALF. `AppShell` does not render
// `SupportDock`, so "Ground now" and "Talk to someone" existed on Today and
// disappeared for the rest of the member's journey. Measured across ten member
// routes: one had the dock, nine did not. MemberShell's own docstring says the
// dock belongs to the shell "because a page that renders its own support is a
// page somebody forgets to" — which is precisely what happened, one shell
// further out.
//
// THE FLAG STILL MEANS WHAT IT MEANT. §10.1 requires that the current
// experience is unchanged with each flag off, so this chooses rather than
// replaces: with EXPERIENCE_MEMBER_SHELL on, every member screen gets the
// member's shell; with it off, every member screen gets the frame it had. The
// defect was never which of the two — it was having both at once.
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
   *  "what do I do now" screen.
   *
   *  STILL LOAD-BEARING, and only for the flag-off frame below. The member's
   *  own shell navigates by destination rather than by layer, so this is read
   *  by one of the two branches — kept rather than removed because the other
   *  branch is what a reviewer sees when they turn the flag off. */
  layer?: RailSlug;
  children: React.ReactNode;
  /** The meaning card beside the content, where a screen has one. */
  aside?: React.ReactNode;
}) {
  if (memberShellEnabled()) {
    return (
      <MemberShell navigation={memberNavigation()} title={title} lede={lede}>
        {children}
      </MemberShell>
    );
  }

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
          <button className="inline-flex min-h-6 items-center hover:underline">Sign out</button>
        </form>
      }
      aside={aside}
    >
      {lede && <p className="measure -mt-1 mb-6 text-olive">{lede}</p>}
      {children}
    </AppShell>
  );
}
