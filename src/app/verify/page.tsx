import { AccessPage } from "@/components/site/AccessPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Second factor — Steady" };

// Verification (§26: "/verify — Complete second factor — six-digit code —
// Verify").
//
// There is no second factor in this deployment. The login page already says
// production requires AAL2 for all accounts, and this is the screen where that
// would happen.
//
// What this screen must NOT be is a six-digit input that accepts anything. A
// code box is a promise about how the account is protected, and one that lets
// any six digits through is worse than no box at all: it teaches a reviewer
// that the control exists and works, and it teaches a member to stop reading
// the screen that is meant to make them pause. Security theatre is the one
// kind of unfinished work that makes the system less safe rather than merely
// less complete.

export default function VerifyPage() {
  return (
    <AccessPage
      title="Two-factor sign-in isn't set up here"
      primary={{ href: "/login", label: "Back to sign in" }}
      secondary={{ href: "/trust", label: "How access works" }}
    >
      <p>
        This environment signs in with an email and password only. In production, every
        account requires a second factor before it reaches any record.
      </p>
      <p className="text-sm text-olive">
        There is deliberately no code box on this page. A six-digit field that accepts any
        six digits would demonstrate a control that does not exist, and a reviewer would have
        no way to tell the difference by looking.
      </p>
    </AccessPage>
  );
}
