import { AccessPage } from "@/components/site/AccessPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invitation — Steady" };

// Accept invitation (§26: "/invite/:token — Join scoped review — role,
// purpose, expiration — Accept").
//
// The token is deliberately not read, echoed, or looked up.
//
// An invitation token is a bearer credential: whoever holds it holds the
// access. Rendering it back into the page puts it in the browser history, the
// server logs and any screenshot of this screen — and looking it up to say
// "that invitation has expired" versus "no such invitation" tells whoever is
// guessing which guesses are close. Neither is worth doing for a flow that
// does not exist yet.
//
// Scoped review access DOES exist, through /request-review, so this points
// there rather than leaving someone with an invitation and nowhere to take it.

export default function InvitePage() {
  return (
    <AccessPage
      title="Invitation links aren't set up yet"
      primary={{ href: "/request-review", label: "Request review access" }}
      secondary={{ href: "/", label: "Return home" }}
    >
      <p>
        Scoped review access is granted through a request rather than a link. Requesting it
        names a role, a purpose and an expiry, which is what an invitation would have to
        carry anyway.
      </p>
      <p className="text-sm text-olive">
        This page does not read the token in the address. An invitation token is a
        credential: showing it back would put it in browser history and server logs, and
        checking it would let someone guessing tell a wrong token from an expired one.
      </p>
    </AccessPage>
  );
}
