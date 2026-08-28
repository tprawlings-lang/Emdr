import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PublicPage, BoundaryNote } from "@/components/site/PublicChrome";
import { reviewPath, personasFor } from "@/lib/site/review-access";
import { enterPersonaAction } from "@/lib/site/demo-actions";
import { DEMO_SEED_VERSION } from "@/lib/demo-seed";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  scope: "That persona is outside the scope of your review path.",
  persona: "That persona is not available in this environment. It may need a reset.",
  denied: "Your review access was not recognised. Start again from the gateway.",
};

// Step three and four of the gateway sequence (§12): select a persona within
// the scope of the granted path, then enter the guided scenario.
export default async function DemoPath({
  params, searchParams,
}: {
  params: Promise<{ path: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { path } = await params;
  const { error } = await searchParams;

  const cfg = reviewPath(path);
  if (!cfg) redirect("/demo?error=path");

  // The grant cookie, not the URL, decides access. Typing a different path
  // reaches nothing.
  const granted = (await cookies()).get("steady_review_path")?.value;
  if (granted !== cfg!.id) redirect(`/demo?error=denied&path=${cfg!.id}`);

  const personas = personasFor(cfg!);

  return (
    <PublicPage eyebrow="Review environment" title={cfg!.title} lede={cfg!.purpose}>
      <div className="mt-8">
        <BoundaryNote extra="You are entering a fabricated environment. Anything you record here affects invented records only." />
      </div>

      {error && ERRORS[error] && (
        <p className="mt-4 rounded-2xl border border-support/40 bg-support/10 px-4 py-3 text-sm text-support-deep">
          {ERRORS[error]}
        </p>
      )}

      <section className="mt-10">
        <h2 className="type-display text-2xl font-medium text-ground">Choose a fabricated persona</h2>
        <p className="mt-2 text-sm text-olive">
          {cfg!.writeCapable
            ? "Your path includes a role that can record decisions against fabricated records."
            : "Your path is read-only. Roles that can record decisions are not offered here."}
        </p>
        <ul className="mt-4 space-y-3">
          {personas.map((p) => (
            <li key={p.email} data-testid="persona-option" className="rounded-2xl border border-ground/15 bg-linen/40 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ground">{p.label}</span>
                <span className="rounded-full bg-ground/10 px-2 py-0.5 text-xs">{p.role}</span>
              </div>
              <p className="mt-1 text-sm text-ground/80">{p.description}</p>
              <form action={enterPersonaAction} className="mt-3">
                <input type="hidden" name="path" value={cfg!.id} />
                <input type="hidden" name="email" value={p.email} />
                <button className="rounded-full bg-ground px-4 py-1.5 text-sm font-medium text-ivory">
                  Enter as this persona
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="type-display text-2xl font-medium text-ground">What to look at</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ground/80">
          {cfg!.focus.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="mt-4 text-sm text-olive">
          Dataset <code className="text-xs">{DEMO_SEED_VERSION}</code>. If the environment looks
          wrong, it can be reset to a reproducible baseline — a reset is a feature of this
          environment, not a failure of it.
        </p>
      </section>

      <p className="mt-10 text-sm text-olive">
        <Link href="/demo" className="underline">← Choose a different path</Link>
      </p>
    </PublicPage>
  );
}
