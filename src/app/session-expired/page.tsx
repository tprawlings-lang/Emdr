import { AccessPage } from "@/components/site/AccessPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session expired — Steady" };

// Session expired (§26: "/session-expired — Re-enter safely — no retained
// unsaved text — Sign in").
//
// "No retained unsaved text" is a promise, and this screen is where it is made
// explicit rather than assumed. A session that ends must not leave a half-typed
// check-in answer or a companion message sitting in storage where the next
// person at the same machine can recover it — and a member is entitled to be
// told that, because otherwise the safe assumption is the opposite.

export default function SessionExpired() {
  return (
    <AccessPage
      title="You were signed out"
      primary={{ href: "/login", label: "Sign in again" }}
      secondary={{ href: "/crisis", label: "Get support now" }}
    >
      <p>
        Sessions end after a period of inactivity, and on a shared computer that is the
        point. Everything you had already saved is safe.
      </p>
      <p className="text-sm text-olive">
        Anything you were part-way through typing was not kept. That is deliberate: unsent
        text left behind on a shared machine is readable by whoever sits down next.
      </p>
    </AccessPage>
  );
}
