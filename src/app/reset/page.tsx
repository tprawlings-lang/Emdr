import { AccessPage } from "@/components/site/AccessPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Password reset — Steady" };

// Password reset (§26: "/reset — Recover account — approved email flow — Send
// link").
//
// A reset link needs a delivery channel, and this deployment has none — the
// same absence that made four surfaces claim a care team "has been notified"
// with no receipt to show for it. A "we've sent you a link" confirmation here
// would be that defect again, in the place where it strands someone hardest:
// waiting for an email that was never sent, from an account they cannot get
// back into.

export default function ResetPage() {
  return (
    <AccessPage
      title="Password reset isn't available here"
      primary={{ href: "/login", label: "Back to sign in" }}
      secondary={{ href: "/request-review", label: "Request review access" }}
    >
      <p>
        Resetting a password needs an email channel to send the link through, and this
        environment does not have one. Nothing would arrive.
      </p>
      <p className="text-sm text-olive">
        The screen could show a form and a &ldquo;check your inbox&rdquo; message, and it
        would look finished. Someone locked out would then wait for an email that was never
        sent — which is worse than being told plainly, now.
      </p>
    </AccessPage>
  );
}
