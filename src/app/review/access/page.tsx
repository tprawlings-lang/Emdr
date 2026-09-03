import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Callout, SummaryCards } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { listAccessRequests } from "@/lib/review/access";
import { requestScopedAccess, decideAccessRequest } from "@/lib/review/actions";
import { ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access requests — Steady Review" };

// §26 p44: "Access requests — /review/access — Approve scoped access — Role,
// purpose, expiration — Approve or deny".
//
// Three fields, and each one is a constraint rather than a label. A request
// with no stated purpose cannot be judged; a request with no expiry is not
// scoped; and a request approved by the person who raised it is not reviewed.
// All three are refused by the action rather than discouraged by the form.

const ERRORS: Record<string, string> = {
  incomplete: "A request needs both a role and a purpose. A purpose supplied afterwards is a justification, not a reason.",
  bad_expiry: "A request needs an expiry between 1 and 365 days. An open-ended grant is not a scope.",
  reason_required: "Denying a request needs a reason — the requester has to know what would make it approvable.",
  self_approval: "A reviewer cannot approve their own request. That is the failure this screen exists to prevent.",
};

export default async function AccessRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireReviewAccess();
  const { error } = await searchParams;
  const requests = await listAccessRequests();

  const pending = requests.filter((r) => !r.decision);
  const active = requests.filter((r) => r.decision?.decision === "approved" && !r.expired);
  const expired = requests.filter((r) => r.decision?.decision === "approved" && r.expired);

  return (
    <ReviewPage
      layer="actions"
      here="/review/access"
      title="Access requests"
      lede="Scoped access is a role, a purpose and an expiry, decided by someone other than the person asking. Each part is recorded before the decision, not after it."
    >
      {error && ERRORS[error] && (
        <Callout tone="support" label="Not recorded" className="mb-6">
          {ERRORS[error]}
        </Callout>
      )}

      <SummaryCards
        cards={[
          { label: "Awaiting a decision", value: `${pending.length}`, detail: pending.length ? "needs a reviewer" : "nothing outstanding" },
          { label: "Active grants", value: `${active.length}`, detail: "approved and not yet expired" },
          { label: "Expired grants", value: `${expired.length}`, detail: "approved, expiry passed — no longer access" },
        ]}
      />

      <Panel title="Raise a request" className="mt-6">
        <form action={requestScopedAccess} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-olive">Role requested</span>
              <select name="requested_role" required className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2">
                <option value="">Choose…</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-olive">Expires after (days)</span>
              <input
                name="days"
                type="number"
                min={1}
                max={365}
                defaultValue={30}
                required
                className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-olive">What it is needed for</span>
            <textarea name="purpose" rows={2} maxLength={500} required className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2" />
          </label>
          <button className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface">Submit request</button>
        </form>
      </Panel>

      <Panel title="Requests" className="mt-6" footnote="Denied and expired requests stay listed. A request that vanishes when refused destroys the evidence that it was made.">
        {requests.length === 0 ? (
          <p className="text-sm text-olive">
            No requests have been raised. This is an empty list, not an unavailable screen — the form above writes to it.
          </p>
        ) : (
          <ul className="space-y-4">
            {requests.map((r) => {
              const own = r.requestedBy === user.id;
              return (
                <li key={r.id} className="rounded-xl border border-ground/10 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-app-accent/60 px-2.5 py-1 text-xs font-medium text-app-ink">{r.requestedRole}</span>
                    {r.decision ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          r.decision.decision === "approved"
                            ? r.expired
                              ? "bg-app-accent/60 text-app-ink"
                              : "bg-emerald-50 text-emerald-900"
                            : "bg-rose-50 text-rose-900"
                        }`}
                      >
                        {r.decision.decision === "approved" ? (r.expired ? "Expired" : "Approved") : "Denied"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">Awaiting decision</span>
                    )}
                  </div>

                  <p className="mt-3 text-sm text-app-ink">{r.purpose}</p>
                  <p className="mt-2 text-xs text-olive">
                    Raised by {r.requesterName ?? "unknown"} on {new Date(r.createdAt).toLocaleString()} · expires{" "}
                    {new Date(r.expiresAt).toLocaleString()}
                  </p>
                  {r.decision && (
                    <p className="mt-1 text-xs text-olive">
                      Decided by {r.decision.actorRole} on {new Date(r.decision.createdAt).toLocaleString()}
                      {r.decision.rationale ? ` — “${r.decision.rationale}”` : ""}
                    </p>
                  )}

                  {!r.decision &&
                    (own ? (
                      <p className="mt-3 rounded-xl bg-app-accent/40 px-4 py-3 text-sm text-app-ink">
                        You raised this request, so you cannot decide it. Another reviewer has to.
                      </p>
                    ) : (
                      <form action={decideAccessRequest} className="mt-3 space-y-3 border-t border-ground/10 pt-3">
                        <input type="hidden" name="request_id" value={r.id} />
                        <label className="block text-sm sm:max-w-xs">
                          <span className="mb-1 block text-olive">Decision</span>
                          <select name="decision" required className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2">
                            <option value="">Choose…</option>
                            <option value="approved">Approve</option>
                            <option value="blocked">Deny</option>
                          </select>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1 block text-olive">Reason (required to deny)</span>
                          <textarea name="rationale" rows={2} maxLength={1000} className="w-full rounded-xl border border-ground/20 bg-app-surface px-3 py-2" />
                        </label>
                        <label className="flex items-start gap-2 text-sm text-olive">
                          <input type="checkbox" required className="mt-1" />
                          <span>
                            I am granting the <strong>{r.requestedRole}</strong> role until{" "}
                            {new Date(r.expiresAt).toLocaleDateString()}, for the stated purpose only.
                          </span>
                        </label>
                        <button className="rounded-full bg-app-ink px-4 py-2 text-sm font-medium text-app-surface">Record decision</button>
                      </form>
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </ReviewPage>
  );
}
