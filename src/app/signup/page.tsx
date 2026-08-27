import { redirect } from "next/navigation";

// Public enrollment is closed (Redesign handoff §12).
//
// This is the route that was letting real people put real email addresses into
// a review environment — and, via `login_failed` auditing, into its audit
// console. Closing it is the load-bearing half of the §1/§3 release gate: a
// reset without this simply re-contaminates on the next visitor.
//
// The route is kept as a redirect rather than deleted so that any existing
// link, bookmark, or index entry lands somewhere honest instead of a 404.
export default function SignupClosed() {
  redirect("/request-review?from=signup");
}
