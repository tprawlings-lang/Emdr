// The shared person header (§10.4's sticky header).
//
// Six sub-routes need the same five facts. Reading them once, in one place,
// keeps them consistent between tabs — a header that says "consent active" on
// one tab and nothing on the next is worse than no header.
//
// Tenant scoping lives here too, so a sub-route cannot ship unscoped by
// forgetting the WHERE clause. §20.3: "Cross-tenant and unauthorized person
// requests return no record detail."

import { data } from "../data";
import { activePolicy } from "../clinical-policy";
import { buildWorkQueue } from "./work-queue";
import type { PersonHeader } from "@/components/clinical/PersonShell";

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

  const head = queue.items.find((i) => i.personId === person.id) ?? null;
  return {
    id: person.id,
    name: person.name,
    band: head?.band ?? "none",
    ownerName: head?.ownerName ?? null,
    evidenceAt: head?.evidenceAt ?? null,
    now: queue.computedAt,
    consentActive: !!consent,
  };
}
