import {
  CONTACT_MEANING, NO_CARE_HISTORY, type CareHistoryEntry,
} from "@/lib/clinical/care-history";

// What was done between visits, beside the reviews rather than mixed into them.
//
// A REVIEW CARRIES A CURRENCY AND A CONTACT ATTEMPT DOES NOT. The review ledger
// answers "does this decision still describe the record"; asking that of a
// phone call is not a question, and the currency policy says so in as many
// words. So this is a second section rather than four more rows: one label on
// the wrong kind of entry is how two records become confusable.
export function CareHistoryLedger({ entries }: { entries: CareHistoryEntry[] }) {
  return (
    <section aria-labelledby="care-history" className="mt-8">
      <h2 id="care-history" className="type-display text-lg font-medium text-ground">
        Between visits
      </h2>

      {entries.length === 0 ? (
        <p className="measure mt-2 text-sm text-olive">{NO_CARE_HISTORY}</p>
      ) : (
        <>
          <ul className="mt-3 space-y-3">
            {entries.map((e) => (
              <li
                key={e.id}
                data-testid="care-history-entry"
                className="rounded-3xl border border-ground/10 bg-linen p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ground">{e.label}</p>
                  <p className="text-sm text-olive">{e.at.slice(0, 16)}</p>
                </div>
                {e.note && <p className="measure mt-1 text-sm text-ground">{e.note}</p>}
                {/* ON THE ROW IT DESCRIBES, and it took two goes to get here.
                    A reader who counts three attempts and concludes somebody
                    was reached has been misled by a list that was accurate, so
                    the sentence has to be somewhere — but it sat ABOVE THE
                    WHOLE LIST, which was fine only while every entry was a
                    contact attempt. Three actions joined on 23 September and it
                    was made conditional on there being a contact, which fixed
                    the empty case and not the mixed one: a ledger holding one
                    call and one plan-link adjustment still captioned both with
                    a sentence about calls. Found by driving the product, not by
                    the test — which asserted the shape of the condition rather
                    than what a reader sees.

                    REPEATED PER CONTACT ROW, DELIBERATELY. It is the pattern the
                    plan's completion lines already use, and a caveat that
                    travels with its fact cannot drift onto something else the
                    next time this list grows. */}
                {e.action === "contact" && (
                  <p className="measure mt-1 text-xs text-olive">{CONTACT_MEANING}</p>
                )}
                {e.owner && (
                  <p className="mt-1 text-xs text-olive">
                    Owner recorded. Nobody was notified — there is no delivery path in this build.
                  </p>
                )}
                {e.corrects && (
                  /* A correction APPENDS. The entry it replaces is still in the
                     ledger above or below this one, which is what makes the
                     record checkable rather than rewritten. */
                  <p className="measure mt-1 text-xs text-olive">
                    Corrects an earlier entry, which is still recorded.
                    {e.correctionReason ? ` Reason: ${e.correctionReason}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
