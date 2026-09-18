import { currentGeneration } from "@/lib/environment-generation";

// 17 September handoff, the demo row: "Persistent fabricated-data label, active
// persona, scenario date, ENVIRONMENT GENERATION, and reset state."
//
// WHY A PERSON NEEDS TO SEE IT. A tab open across a demo reset looks identical
// to a fresh one — same layout, same names, same rows — and its buttons are now
// refused, because the records it is showing were deleted and recreated. The
// refusal says to reload, and this is what lets somebody confirm the two tabs
// on their screen are not in the same environment before they trust either.
//
// SHORTENED, NOT HASHED. Six characters is enough to tell two generations apart
// at a glance, which is the only comparison anybody makes with it, and the
// title carries the whole identifier for anybody who needs to quote it.
export async function GenerationBadge() {
  const { generation, establishedAt } = await currentGeneration();
  return (
    <span
      className="rounded-full border border-ground/20 px-3 py-1 font-mono text-xs text-olive"
      title={
        `Environment generation ${generation}, established ${establishedAt.slice(0, 16).replace("T", " ")}. ` +
        "A demonstration reset starts a new one. A page loaded under an older generation is showing " +
        "records that no longer exist, and its actions are refused rather than written."
      }
    >
      Env {generation.slice(0, 6)}
    </span>
  );
}
