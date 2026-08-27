// Age eligibility at account creation (compliance packet 4A.7).
//
// A pure rule in its own module, for two reasons. `lib/actions.ts` carries
// "use server", so every export there must be an async Server Action — a
// synchronous helper cannot live in it. And a safety rule deserves to be
// testable without a browser: public enrollment is now closed (Redesign
// handoff §12), so the end-to-end spec that used to cover this no longer has a
// form to drive. The rule still runs on any future controlled-enrollment path,
// and it keeps its own coverage in tests/signup-gates.test.ts.
//
// Minors are out of scope entirely. The fitness screener re-checks fit later,
// but age is decided here, once, and is never re-litigated downstream.

export type AgeVerdict = "ok" | "dob" | "age";

export function checkAgeEligibility(dob: string, now: number = Date.now()): AgeVerdict {
  if (!dob) return "dob";
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return "dob";
  const age = (now - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 18) return "age";
  if (age > 120) return "dob";
  return "ok";
}
