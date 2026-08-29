import Link from "next/link";
import { OrgPage } from "@/components/app/OrgPage";
import { Panel } from "@/components/app/surfaces";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams — Steady Intelligence" };

// Teams (§26: "Compare workload and overdue work — team-level operations —
// open team").
//
// There is no team. Not an empty list of teams — no team concept at all: the
// tenancy spine models platform, organization, facility and program, and a
// team is none of those. Work items carry an owner, which is a person, and
// rolling people up by "whoever their manager is" is an inference nothing in
// this system records.
//
// A workload comparison built on that inference would be a performance
// ranking of teams that do not exist, published to the people who set their
// budgets. Rendering an empty table instead would say the teams exist and are
// idle. So the screen says what is missing and what it would take.

export default function OrgTeamsPage() {
  return (
    <OrgPage
      layer="actions"
      here="/organization/teams"
      title="Teams"
      lede="Team-level operations are not part of this environment."
    >
      <div className="space-y-6">
        <Panel>
          <p className="measure text-ground/90">
            There is no team record. The tenancy model has organizations, facilities and
            programs; a team is none of them. Work items carry an individual owner, and
            grouping owners into teams would be an inference this system does not record.
          </p>
          <p className="measure mt-3 text-sm text-olive">
            A workload comparison built on that inference is a performance ranking of teams
            that do not exist, shown to the people who set their budgets. An empty table
            would be worse still: it would say the teams exist and have nothing to do.
          </p>
        </Panel>

        <Panel title="What this screen needs">
          <ul className="space-y-2 text-sm text-ground">
            {[
              "A team record with membership that is effective-dated, so a comparison can say which period it covers.",
              "Work items assigned to a team as well as to a person, so workload is attributable without inferring a hierarchy.",
              "An overdue definition that belongs to the team's own service standard rather than to the queue's global one.",
            ].map((t) => <li key={t} className="measure">{t}</li>)}
          </ul>
        </Panel>

        <Panel title="What does work">
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/organization/locations" className="text-state-info underline">Locations</Link>
              {" "}compares sites, which are modelled, against their own populations.
            </li>
            <li>
              <Link href="/organization/care-delivery" className="text-state-info underline">Care delivery</Link>
              {" "}reports review coverage across the network.
            </li>
          </ul>
        </Panel>
      </div>
    </OrgPage>
  );
}
