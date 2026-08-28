import Link from "next/link";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { REVIEW_PATHS, gatewayConfigured } from "@/lib/site/review-access";
import { enterReviewAction } from "@/lib/site/demo-actions";
import { BOUNDARY } from "@/lib/site/registry";
import { DEMO_SEED_VERSION } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Review environment — Steady",
  description: "Controlled entry to the fabricated Steady review environment.",
};

const ERRORS: Record<string, string> = {
  denied: "That code was not accepted. Check it with whoever arranged your review.",
  path: "Choose a review path to continue.",
  unavailable: "The review environment is not currently open. Request access to arrange a session.",
};

// The review gateway (Redesign handoff §12). Step one of the four-step sequence:
// choose a purpose, read the boundary, select a persona, enter a guided scenario.
export default async function DemoGateway({
  searchParams,
}: { searchParams: Promise<{ error?: string; path?: string }> }) {
  const { error, path } = await searchParams;
  const open = gatewayConfigured();

  return (
    <PublicPage
      eyebrow="Review environment"
      title="Enter the fabricated demonstration"
      lede="Every person, record, and clinician in this environment is invented. Nothing in it is a real member, real health information, or approved care."
    >
      <div className="mt-8"><BoundaryNote extra={BOUNDARY.demoData} /></div>

      {error && ERRORS[error] && (
        <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
          {ERRORS[error]}
        </p>
      )}

      <section className="mt-10">
        <h2 className="type-display text-2xl font-medium text-ground">What you are about to see</h2>
        <ul className="mt-3 space-y-2 text-sm text-ground/80">
          <li><strong>Fabricated data only.</strong> Dataset <code className="text-xs">{DEMO_SEED_VERSION}</code>, reset to a reproducible baseline.</li>
          <li><strong>No clinical care.</strong> No therapy, diagnosis, treatment, or emergency service.</li>
          <li><strong>No real-time monitoring.</strong> No one is watching this environment and no care team is assigned.</li>
          <li><strong>No public enrollment.</strong> Access is arranged per reviewer and scoped to a purpose.</li>
        </ul>
      </section>

      {!open ? (
        <section className="mt-10 rounded-2xl border border-pause/50 bg-pause-soft px-6 py-5">
          <h2 className="type-display text-2xl font-medium text-ground">Access is closed</h2>
          <p className="mt-2 text-sm text-ground/80">
            No review code is configured for this deployment, so the gateway is closed. That is
            the intended state when access has not been arranged — a missing configuration
            never means open.
          </p>
          <Link href="/request-review" className="mt-3 inline-block rounded-full bg-ground px-5 py-2 text-sm font-medium text-ivory">
            Request a review
          </Link>
        </section>
      ) : (
        <section className="mt-10">
          <h2 className="type-display text-2xl font-medium text-ground">Choose your review path</h2>
          <p className="mt-2 text-sm text-olive">
            Your access is scoped to the purpose you choose. You will never be shown or asked
            for a password.
          </p>
          <form action={enterReviewAction} className="mt-4 space-y-4">
            <fieldset className="space-y-2">
              <legend className="sr-only">Review path</legend>
              {REVIEW_PATHS.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer gap-3 rounded-2xl border border-ground/15 bg-linen/40 px-5 py-4"
                >
                  <input
                    type="radio" name="path" value={p.id} required
                    defaultChecked={path === p.id}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium text-ground">{p.title}</span>
                    <span className="mt-0.5 block text-sm text-ground/80">{p.purpose}</span>
                    <span className="mt-1 block text-xs text-olive">
                      {p.writeCapable ? "Includes a review role that can record decisions" : "Read-only guided views"}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div>
              <label htmlFor="code" className="block text-sm font-medium text-ground">
                Review access code
              </label>
              <input
                id="code" name="code" required autoComplete="off"
                className="mt-1 w-full max-w-sm rounded-lg border border-ground/20 bg-ivory px-3 py-2 text-sm"
                placeholder="Provided when your review was arranged"
              />
              <p className="mt-1 text-xs text-olive">
                Do not share this code. It is scoped to your review and can be rotated.
              </p>
            </div>

            <button className="rounded-full bg-ground px-5 py-2.5 text-sm font-medium text-ivory">
              Continue
            </button>
          </form>
        </section>
      )}

      <p className="mt-10 text-sm text-olive">
        Looking for support rather than a review? Steady is not open for enrollment and is not
        an emergency service. The{" "}
        <Link href="/crisis" className="underline">crisis resources page</Link> is public and
        always available.
      </p>
    </PublicPage>
  );
}
