import { AccessPage } from "@/components/site/AccessPage";

export const metadata = { title: "Page not found — Steady" };

// Not found (§26: "/404 — Return to an allowed path — no data leak — Return
// home").
//
// This replaces Next's built-in error page, which rendered a black system-font
// "404" on white inside the demo banner: the one screen in the product that
// looked like a different product.
//
// "No data leak" is the load-bearing requirement and it is about what this
// page does NOT say. It never echoes the path that was requested and never
// distinguishes "no such thing" from "a thing you may not see" — because a
// visitor who can tell those apart can enumerate what exists by watching which
// answer comes back. Elsewhere in this codebase the same rule is why a
// cross-tenant record returns not-found rather than forbidden.

export default function NotFound() {
  return (
    <AccessPage
      title="That page isn't here"
      primary={{ href: "/", label: "Return home" }}
      secondary={{ href: "/login", label: "Sign in" }}
    >
      <p>
        The address may have changed, or it may never have existed. Nothing is wrong with
        your account, and nothing you have saved is affected.
      </p>
      <p className="text-sm text-olive">
        This page deliberately does not say which of those it is. Telling the difference
        between &ldquo;no such page&rdquo; and &ldquo;a page you cannot open&rdquo; is how
        someone maps what a system holds without ever signing in.
      </p>
    </AccessPage>
  );
}
