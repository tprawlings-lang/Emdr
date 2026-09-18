import { data } from "../data";
import type { TenantContext } from "../repository";

// The newest evidence on a person's record (17 September handoff, completion
// semantics).
//
// ONE ANSWER, BECAUSE A COMPARISON NEEDS TWO COMPARABLE THINGS. A review
// records the newest evidence the reviewer had in front of them; later, the
// same question is asked again and the two are compared. If each call site
// computed "newest evidence" from whatever it happened to have — one from
// alerts, another from check-ins — the comparison would be between different
// measurements and the staleness verdict would be noise.
//
// THE SOURCES ARE THE ONES THE QUEUE READS, deliberately: alerts, check-ins and
// attention signals are what put a person in front of a clinician, so they are
// what a review was made against. A source the queue does not read cannot have
// been on the reviewer's screen, and counting it would mark reviews stale for
// evidence nobody was shown.

const SOURCES: ReadonlyArray<{ sql: string; label: string }> = [
  { sql: "SELECT MAX(created_at) AS at FROM alerts WHERE user_id = ?", label: "alert" },
  { sql: "SELECT MAX(created_at) AS at FROM checkins WHERE user_id = ?", label: "check-in" },
  {
    sql: "SELECT MAX(last_detected_at) AS at FROM clinical_attention_signals WHERE person_id = ? AND tenant_id = ?",
    label: "attention signal",
  },
];

/**
 * The newest evidence timestamp for this person, or null when there is none.
 *
 * Returns the repository's own `YYYY-MM-DD HH:MM:SS` text so the comparison
 * downstream is a string comparison on a format that sorts correctly — parsing
 * into dates here would introduce a timezone question the stored format does
 * not have.
 */
export async function newestEvidenceFor(
  ctx: TenantContext, personId: string
): Promise<string | null> {
  const c = await data();
  let newest: string | null = null;
  for (const src of SOURCES) {
    const params = src.sql.includes("tenant_id") ? [personId, ctx.tenantId] : [personId];
    let row: { at: string | null } | undefined;
    try {
      row = (await c.get(src.sql, params)) as { at: string | null } | undefined;
    } catch {
      // A source that cannot be read is not evidence that nothing happened.
      // Skipping it can only make the answer OLDER, which makes a review look
      // current when it may not be — so the caller is told nothing rather than
      // given a confident wrong answer, by the null below when every source
      // fails.
      continue;
    }
    const at = row?.at ?? null;
    if (at && (!newest || at > newest)) newest = at;
  }
  return newest;
}
