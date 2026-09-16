import { getCurrentUser } from "@/lib/auth";
import { isRealAccount } from "@/lib/enrollment/pilot-terms";

// The demonstration boundary, in the frame, on every screen.
//
// IT USED TO SAY "FABRICATED" UNCONDITIONALLY, which was true for as long as
// every account in this deployment was invented. It stopped being true when
// real people started enrolling, and the contradiction was worst exactly where
// it mattered most: a pilot participant reading "FABRICATED" in the corner
// while deciding what a clinician may record about them, directly beneath a
// banner telling them theirs is "a real account, not a fabricated persona".
// Two labels, one screen, opposite claims.
//
// SO IT DESCRIBES THE ACCOUNT, not the environment. That is the narrow honest
// claim this corner can make: who you are signed in as. What you are LOOKING
// at is a different question — a clinician's own account is fabricated while
// the record open in front of them may not be — and the pages that show other
// people's data answer it themselves rather than leaning on a chip.
//
// It fails toward the demonstration label: an account whose provenance cannot
// be read is flagged fabricated, because the cost of wrongly calling a real
// account fabricated is a confused participant, and the cost of wrongly
// calling a fabricated one real is a reader trusting invented data.

export async function ProvenanceFlag() {
  const user = await getCurrentUser();
  const real = await isRealAccount(user?.id);

  return real ? (
    <span
      className="rounded-full border border-ground/25 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-app-ink"
      title="You are signed in to a real account. What you enter here is your own, not part of the fabricated demonstration population."
    >
      Real account
    </span>
  ) : (
    <span className="rounded-full bg-app-flag px-3 py-1 text-xs font-semibold uppercase tracking-wide text-app-ink">
      Fabricated
    </span>
  );
}
