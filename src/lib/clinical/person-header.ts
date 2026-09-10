// The shared person header (§10.4's sticky header).
//
// Six sub-routes need the same five facts. Reading them once, in one place,
// keeps them consistent between tabs — a header that says "consent active" on
// one tab and nothing on the next is worse than no header.
//
// Tenant scoping lives here too, so a sub-route cannot ship unscoped by
// forgetting the WHERE clause. §20.3: "Cross-tenant and unauthorized person
// requests return no record detail."

import { headers } from "next/headers";

import { data } from "../data";
import { audit } from "../audit";
import { activePolicy } from "../clinical-policy";
import type { ProjectionMeta } from "../presentation/envelope";
import { buildWorkQueue } from "./work-queue";
import type { PersonHeader } from "@/components/clinical/PersonShell";

/** The contract shape of the person record (§30.3's `clinician_patient`).
 *
 *  Bumped when the header's five facts change meaning, not when the page
 *  around them is restyled — a version that moves on a layout change teaches
 *  a reader to ignore it. */
export const CLINICIAN_PATIENT_SCHEMA = "clinician_patient.v1";

export async function loadPersonHeader(args: {
  personId: string;
  clinicianId: string;
  tenantId: string;
}): Promise<PersonHeader | null> {
  const c = await data();
  const person = (await c.get(
    "SELECT id, name FROM users WHERE id = ? AND tenant_id = ? AND role = 'member'",
    [args.personId, args.tenantId]
  )) as { id: string; name: string } | undefined;
  if (!person) return null;

  const policy = activePolicy();
  const [queue, consent] = await Promise.all([
    buildWorkQueue({ clinicianId: args.clinicianId, tenantId: args.tenantId, policy }),
    c.get(
      "SELECT granted_at FROM consents WHERE user_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC LIMIT 1",
      [args.personId]
    ) as Promise<{ granted_at: string } | undefined>,
  ]);

  // §30.6 STEP 7, AT THE ONE PLACE EVERY PERSON TAB PASSES THROUGH.
  //
  // Reading somebody else's record is the access an audit trail exists to
  // record, and it was happening on eight of the fifteen clinician person tabs
  // without one. The two that did audit each wrote their own event from their
  // own page — the same shape as the five prefixes of the member gate chain,
  // one layer down.
  //
  // It goes here rather than on the pages because the tenant scope already
  // does: a sub-route cannot ship unscoped by forgetting the WHERE clause, and
  // it should not be able to ship unaudited by forgetting a line either.
  //
  // AFTER THE LOOKUP, NEVER BEFORE. A person outside this tenant returns null
  // above, and recording a read of a record that was refused would put the
  // subject's id in the trail on the strength of somebody guessing it.
  await recordAccess(args.personId, args.clinicianId);

  const head = queue.items.find((i) => i.personId === person.id) ?? null;

  // §30.6 STEP 8, FOR THE SAME REASON STEP 7 IS HERE.
  //
  // The person record is §30.3's `clinician_patient` projection, and it was
  // the one on that list handing out a payload with no version on it. What
  // that costs is not abstract: the band, the owner and the freshness label
  // are read off this header and quoted in a handoff or a supervision note,
  // and a reader who cannot say which build and which policy produced them
  // cannot tell a stale screenshot from a current one.
  //
  // The POLICY VERSION is in the projection version rather than beside it,
  // because a change to the priority policy changes what `band` MEANS. Two
  // records under the same schema and different policies are not comparable,
  // and joining them with `+` is what makes that visible at a glance.
  const meta: ProjectionMeta = {
    schemaVersion: CLINICIAN_PATIENT_SCHEMA,
    projectionVersion: `${CLINICIAN_PATIENT_SCHEMA}+${policy.version}`,
    generatedAt: queue.computedAt,
    tenantId: args.tenantId,
    // The newest fact this header reflects, which is the evidence behind the
    // band rather than the moment it was rendered.
    sourceWatermark: head?.evidenceAt ?? null,
    policyVersion: policy.version,
  };

  return {
    id: person.id,
    name: person.name,
    band: head?.band ?? "none",
    ownerName: head?.ownerName ?? null,
    evidenceAt: head?.evidenceAt ?? null,
    now: queue.computedAt,
    consentActive: !!consent,
    meta,
  };
}

/**
 * The access event, with the surface taken from the request rather than from a
 * parameter.
 *
 * Fifteen call sites would otherwise each have to name themselves, which is
 * fifteen chances to name the wrong one. `src/proxy.ts` already sets
 * `x-pathname` for the class of problem where a server component needs to know
 * which route it is serving.
 *
 * Never throws into a render. A failed audit on a READ is not a reason to
 * withhold a chart from a clinician who is with a member — §30.6's fail-closed
 * rule is about protected EVIDENCE and high-impact actions, which is the
 * `audit_unavailable` state in the presentation envelope, not a header.
 */
async function recordAccess(personId: string, clinicianId: string): Promise<void> {
  let surface = "unknown";
  try {
    surface = (await headers()).get("x-pathname") ?? "unknown";
  } catch {
    // Called outside a request. Nothing to name, and nothing to fail.
  }
  try {
    await audit({
      actorId: clinicianId,
      actorRole: "clinician",
      family: "security",
      type: "person_record_viewed",
      target: personId,
      detail: { surface },
    });
  } catch (err) {
    console.error("access audit failed for a person record read:", err);
  }
}
