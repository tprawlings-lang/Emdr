import { AccessPage } from "@/components/site/AccessPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "No access — Steady" };

// No access (§26: "/403 — Understand denied scope — reason and request path —
// Request access").
//
// This is for a SCOPE denial, not a record denial, and the distinction is the
// whole reason the two are separate screens.
//
// A record you are not entitled to see returns not-found, always — §20.3, and
// the reason is that "forbidden" confirms the record exists. That rule is not
// relaxed here. What reaches this screen instead is a denial that reveals
// nothing by existing: a role that has no business on a console, an expired
// review grant, a scope that was never issued. Saying so plainly is safe,
// because the visitor already knows which door they knocked on.

export default function Forbidden() {
  return (
    <AccessPage
      title="You don't have access to that"
      primary={{ href: "/request-review", label: "Request access" }}
      secondary={{ href: "/", label: "Return home" }}
    >
      <p>
        Your account is signed in, and the area you asked for is outside the scope it was
        granted. Nothing has been recorded against you and nothing is wrong with the account.
      </p>
      <p className="text-sm text-olive">
        Access here is scoped rather than tiered: a role is given a purpose and an expiry,
        not a rank. If your work needs this area, requesting it names the purpose so someone
        can decide, rather than escalating you to a level that would open everything.
      </p>
    </AccessPage>
  );
}
