import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { recordRuleSignoff } from "@/lib/actions";
import { getRuleSignoffs } from "@/lib/safety/signoff";
import { CONTENT_RULES, draftsVisible, rowApproved } from "@/lib/content-signoff";
import { CONTENT_V10_APPROVAL } from "@/lib/content-approval";
import { contentUsingRow } from "@/lib/content-registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content sign-off — Steady Review" };

// Handoff 10's content sign-off rows (§3.3). Each row, whether a clinician has
// agreed to it, and — the part that matters — what stays hidden until they do.
// Same storage and the same Agree / Needs-change action as every other
// clinician-reviewed rule; only clinicians see the controls.
export default async function ReviewContentPage() {
  const user = await requireReviewAccess();
  const signoffs = await getRuleSignoffs();
  const canSign = user.role === "clinician";
  const demo = draftsVisible();

  return (
    <ReviewPage
      layer="actions"
      here="/review/content"
      title="Content sign-off"
      lede="New member content does not ship until its row is agreed. Until then it is absent everywhere outside the demonstration."
    >
      <Panel
        title="Rows"
        footnote={
          demo
            ? "This is the demonstration, so unsigned content shows to members marked “Pending clinical review”. In any other environment it is absent."
            : "Unsigned content is absent from every list, screen, phone response and companion suggestion."
        }
      >
        <p className="measure text-sm text-ground">
          The worksheet&apos;s rows, in its words. Lanes A to D were approved by{" "}
          {CONTENT_V10_APPROVAL.reviewers.map((r) => `${r.name} (${r.license})`).join(" and ")} on{" "}
          {CONTENT_V10_APPROVAL.reviewers[0].signedAt}, reference {CONTENT_V10_APPROVAL.reference}; Lane F
          by the founder; Lane E is not signed. A verdict recorded here later takes precedence, so
          a row can still be sent back.
        </p>
        <ul className="mt-4 space-y-3">
          {CONTENT_RULES.map((r) => {
            // The table's latest verdict wins; otherwise the signed record.
            const verdict = signoffs.get(r.id)?.verdict;
            const live = rowApproved(r.id, signoffs);
            const signedBy = CONTENT_V10_APPROVAL.founderRows.includes(r.id) ? "founder"
              : CONTENT_V10_APPROVAL.approvedRows.includes(r.id) ? "reviewers" : null;
            const using = contentUsingRow(r.id);
            return (
              <li key={r.id} className="rounded-2xl border border-ground/10 bg-app-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-xs font-medium text-ground">{r.id}</code>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    live ? "bg-state-safe-bg text-state-safe"
                      : verdict === "needs_change" ? "bg-state-support-bg text-state-support"
                      : "bg-state-unknown-bg text-state-unknown"}`}>
                    {verdict === "needs_change" ? "Needs change"
                      : verdict === "agree" ? "Agreed here"
                      : signedBy === "reviewers" ? "Approved on the signed form"
                      : signedBy === "founder" ? "Signed by the founder"
                      : "Not signed"}
                  </span>
                </div>
                <p className="measure mt-2 text-sm text-ground">{r.reason}</p>
                <p className="measure mt-2 text-xs text-olive">
                  {using.length === 0
                    ? "Nothing in the product uses this row yet."
                    : `${live ? "Live" : "Withheld"}: ${[...new Set(using.map((u) => u.title))].join(", ")}.`}
                </p>
                {canSign && (
                  <form action={recordRuleSignoff} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="rule_id" value={r.id} />
                    <input type="hidden" name="return" value="/review/content" />
                    <input name="note" placeholder="Optional note" aria-label={`Note for ${r.id}`}
                      className="min-w-40 flex-1 rounded-lg border border-ground/15 bg-ivory px-2 py-1 text-sm" />
                    <button name="verdict" value="agree" className="rounded-full bg-state-safe-bg px-3 py-1 text-sm font-medium text-ground">Agree</button>
                    <button name="verdict" value="needs_change" className="rounded-full bg-state-support-bg px-3 py-1 text-sm font-medium text-state-support">Needs change</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </ReviewPage>
  );
}
