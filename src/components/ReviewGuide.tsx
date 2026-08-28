import { cookies } from "next/headers";
import Link from "next/link";
import { reviewPath } from "@/lib/site/review-access";

// The guided review strip.
//
// A reviewer picks a path at /demo and is handed a list of things to look at.
// That list was rendered once, on the gateway, and then forgotten — so from
// the second screen onward they were navigating from memory, in a product with
// no navigation. "I could not find where that was" is the predictable result,
// and it reads as a missing feature rather than a missing signpost.
//
// This carries the list with them. It is collapsed by default so it never
// competes with the work, states where they are, and every item is a link
// rather than a description of somewhere they have to find.
//
// It appears ONLY for someone holding a review grant. A member persona entered
// without one sees nothing — the guide is scaffolding for reviewing the
// product, and leaving it visible would make it part of the product.

export async function ReviewGuide({ current }: { current?: string }) {
  const granted = (await cookies()).get("steady_review_path")?.value;
  if (!granted) return null;

  const cfg = reviewPath(granted);
  if (!cfg) return null;

  return (
    <details
      data-testid="review-guide"
      className="border-b border-ground/10 bg-moss/30"
    >
      <summary className="mx-auto flex max-w-5xl cursor-pointer items-center gap-2 px-6 py-2 text-sm">
        <span className="rounded-full bg-ground px-2.5 py-0.5 text-xs text-ivory">
          {cfg.title}
        </span>
        <span className="text-olive">What you were asked to look at</span>
      </summary>

      <div className="mx-auto max-w-5xl px-6 pb-4">
        <p className="measure text-sm text-ground/80">{cfg.purpose}</p>
        <ol className="mt-3 space-y-1.5">
          {cfg.focus.map((f) => {
            const here = current === f.href;
            return (
              <li key={f.href + f.label} className="text-sm">
                <Link
                  href={f.href}
                  aria-current={here ? "page" : undefined}
                  className={here ? "font-medium text-ground" : "text-ground/80 underline"}
                >
                  {f.label}
                </Link>
                {here && <span className="ml-2 text-xs text-olive">you are here</span>}
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-olive">
          Nothing here is settled. A default you disagree with is a finding, not a
          misunderstanding —{" "}
          <Link href="/clinician/testing" className="underline">
            file it as a change request
          </Link>
          .
        </p>
      </div>
    </details>
  );
}
