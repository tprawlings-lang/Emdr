import type Database from "better-sqlite3";
import crypto from "crypto";
// Imported from ids rather than db: db imports this file, and taking
// PLATFORM_TENANT_ID from there would close the cycle.
import { NIL_ULID as PLATFORM_TENANT_ID } from "./ids";

// The fabricated covered population behind Steady Intelligence
// (Web GUI handoff §26's organization atlas, §29's aggregate charts).
//
// WHY THERE IS A POPULATION AT ALL. The organization screens report on a
// network. The demo tenant has three people in it, so every cell on every one
// of those screens would fall under small-cell suppression and each screen
// would render the same sentence. That demonstrates the suppression rule and
// nothing else — a reviewer could not tell a working funnel from an unbuilt
// one.
//
// WHY IT IS SEEDED AS EVENTS AND NOT AS NUMBERS. §30.1: projections are
// rebuilt from the event ledger; the GUI does not assemble meaning from raw
// tables. Seeding four totals for the access funnel would make the screen a
// picture OF an architecture rather than a product OF one, and the first
// question a reviewer asks — "where does 2,012 come from?" — would have no
// answer. Every number on an organization screen is COUNTED from rows here.
//
// WHY NOBODY HAS A NAME. `persons.display_name` is left NULL for all of them.
// §30.6 requires a minimum-necessary field policy and forbids aggregate access
// from becoming person-level care access. A name the organization role must
// not see is safest when it does not exist: the drilldown is not merely
// refused, it is impossible — the same structural move as the member score
// boundary. It is also what the schema was built for; `persons` documents that
// a person "MAY EXIST WITHOUT AN ACCOUNT: Handoff C3 ingests covered
// populations whose members have never logged in."
//
// SEPARATE TENANT. This population lives under its own organization tenant,
// not the platform tenant the demo member and clinician belong to. A clinician
// caseload scoped by tenant is therefore untouched by 4,820 covered lives —
// and the tenant boundary the rest of the product enforces gets exercised by
// there being something real on the other side of it.
//
// DETERMINISTIC, like the member seed: every id is sha256(version:n) and the
// only randomness is a seeded PRNG, so two seedings of a version produce
// byte-identical rows and the dataset can be baselined.

/** Bump when this dataset changes. */
export const ORG_SEED_VERSION = "org-2026-08-v1";

export function orgId(n: number, version = ORG_SEED_VERSION): string {
  const h = crypto.createHash("sha256").update(`${version}:${n}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join("-");
}

/** Deterministic PRNG. Math.random() would make the dataset unversioned and
 *  unbaselineable, which is the property the member seed exists to keep. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const ORG_TENANT_ID = orgId(0);
export const ORG_NAME = "Northside Behavioral Health";

/** The four sites the location and capacity screens compare. Telehealth is a
 *  location in the operational sense — it has demand, a wait and a queue — so
 *  it sits beside the three physical ones rather than as a modality filter
 *  over them. */
export const ORG_LOCATIONS = [
  { key: "north", name: "North", tenantId: orgId(1), share: 0.31 },
  { key: "central", name: "Central", tenantId: orgId(2), share: 0.29 },
  { key: "east", name: "East", tenantId: orgId(3), share: 0.22 },
  { key: "telehealth", name: "Telehealth", tenantId: orgId(4), share: 0.18 },
] as const;

export type LocationKey = (typeof ORG_LOCATIONS)[number]["key"];

/** Covered lives. The funnel, the coverage percentages and the suppression
 *  threshold only mean anything relative to a denominator, so this is it. */
export const ORG_POPULATION = 4820;

/** Stage conversion, and the wait in days at each step. North is deliberately
 *  the worst performer on contact: the "what changed" line on the overview is
 *  computed, so something has to actually be true for it to say. */
const STAGE = {
  contactAttempted: 0.93,
  contactMade: 0.818,
  scheduled: 0.635,
  started: 0.52,
};

export function seedOrgData(db: Database.Database) {
  // Wrapped here rather than trusting the caller. better-sqlite3 gives every
  // unwrapped statement its own transaction, so ~29,000 inserts become ~29,000
  // commits: measured at 24.6 seconds unwrapped against 292 ms wrapped. Both
  // call sites happen to wrap already, which is exactly why this would have
  // stayed correct until the third one did not. Nested transactions use a
  // savepoint, so this is safe inside an outer one.
  db.transaction(() => seedOrgDataInner(db))();
}

function seedOrgDataInner(db: Database.Database) {
  // Idempotent: a second call on a seeded database is a no-op rather than a
  // constraint error, so boot and reset can both call it unconditionally.
  const existing = db.prepare("SELECT COUNT(*) AS n FROM tenants WHERE id = ?").get(ORG_TENANT_ID) as { n: number };
  if (existing.n > 0) return;

  // The platform tenant is created by the identity-spine backfill, which runs
  // AFTER seeding during a reset — so depending on it existing made this a
  // silent no-op on every reset while working fine at boot. Created here the
  // same way instead, so the order of the two cannot matter.
  db.prepare(
    `INSERT INTO tenants (id, kind, name) VALUES (?, 'platform', 'Steady Platform')
     ON CONFLICT(id) DO NOTHING`
  ).run(PLATFORM_TENANT_ID);

  const at = (daysAgo: number, hour = 9) => {
    const t = new Date(Date.now() - daysAgo * 86400000);
    t.setUTCHours(hour, 0, 0, 0);
    // Never return a future instant — the same trap the member seed documents.
    while (t.getTime() > Date.now()) t.setUTCDate(t.getUTCDate() - 1);
    return t;
  };
  const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

  const insertTenant = db.prepare(
    "INSERT INTO tenants (id, kind, name, parent_tenant_id, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  insertTenant.run(ORG_TENANT_ID, "organization", ORG_NAME, PLATFORM_TENANT_ID, sql(at(400)));
  for (const l of ORG_LOCATIONS) {
    insertTenant.run(l.tenantId, "facility", l.name, ORG_TENANT_ID, sql(at(400)));
  }

  const insertPerson = db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, created_at) VALUES (?, ?, NULL, ?)"
  );
  const insertEnrollment = db.prepare(
    `INSERT INTO enrollments (id, person_id, tenant_id, program_id, eligibility, effective_from, created_at)
     VALUES (?, ?, ?, 'behavioral-health', 'covered', ?, ?)`
  );
  const insertEvent = db.prepare(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id, actor_type,
        occurred_at, recorded_at, source_system, provenance)
     VALUES (?, ?, ?, ?, 1, ?, NULL, 'integration', ?, ?, 'eligibility-feed', ?)`
  );

  // A ULID-shaped id whose time component is the event's own timestamp, so
  // these sort into their true chronological position beside live events —
  // the rule the genesis backfill follows, for the same reason.
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let evSeq = 0;
  const ulidAt = (ms: number) => {
    let t = "";
    let v = ms;
    for (let i = 0; i < 10; i++) { t = B32[v % 32] + t; v = Math.floor(v / 32); }
    const h = crypto.createHash("sha256").update(`${ORG_SEED_VERSION}:e:${evSeq++}`).digest();
    let r = "";
    for (let i = 0; i < 16; i++) r += B32[h[i] % 32];
    return t + r;
  };

  const provenance = JSON.stringify({ feed: "eligibility-feed", fabricated: true });
  const ev = (
    tenantId: string, personId: string, type: string, when: Date, payload: Record<string, unknown> = {},
  ) => {
    const ts = sql(when);
    insertEvent.run(ulidAt(when.getTime()), tenantId, personId, type, JSON.stringify(payload), ts, ts, provenance);
  };

  const rand = rng(20260828);
  let seq = 100;

  for (let i = 0; i < ORG_POPULATION; i++) {
    // Site, by the shares above.
    const r = rand();
    let acc = 0;
    let loc: (typeof ORG_LOCATIONS)[number] = ORG_LOCATIONS[ORG_LOCATIONS.length - 1];
    for (const l of ORG_LOCATIONS) {
      acc += l.share;
      if (r <= acc) { loc = l; break; }
    }

    const personId = orgId(seq++);
    const referredDaysAgo = 15 + Math.floor(rand() * 350);
    const referred = at(referredDaysAgo);
    insertPerson.run(personId, loc.tenantId, sql(referred));
    insertEnrollment.run(orgId(seq++), personId, loc.tenantId, sql(referred), sql(referred));
    ev(loc.tenantId, personId, "referral.received", referred, { source: "primary_care" });

    // North's contact rate is deliberately worse and its wait longer. The
    // overview's "what changed" sentence is computed from these rows, so
    // something has to be true for it to have anything to say.
    const northPenalty = loc.key === "north" ? 0.09 : 0;
    const waitBase = loc.key === "north" ? 4.1 : loc.key === "telehealth" ? 1.4 : 2.4;

    if (rand() > STAGE.contactAttempted) continue;
    const attemptDays = referredDaysAgo - Math.max(0, Math.round(waitBase * 0.4 + rand() * 2));
    ev(loc.tenantId, personId, "contact.attempted", at(attemptDays), {});

    if (rand() > STAGE.contactMade - northPenalty) continue;
    const contactDays = referredDaysAgo - Math.max(0, Math.round(waitBase + rand() * 3));
    ev(loc.tenantId, personId, "contact.made", at(contactDays), {});

    if (rand() > STAGE.scheduled / STAGE.contactMade) continue;
    const schedDays = contactDays - Math.max(0, Math.round(3 + rand() * 9));
    ev(loc.tenantId, personId, "visit.scheduled", at(schedDays), {});

    if (rand() > STAGE.started / STAGE.scheduled) continue;
    const startDays = schedDays - Math.max(0, Math.round(2 + rand() * 11));
    ev(loc.tenantId, personId, "care.started", at(startDays), {});

    // Measure coverage: a validated instrument recorded at least once. The
    // organization screens never see the SCORE — only that one exists — which
    // is the aggregate-side mirror of the member score boundary.
    if (rand() < 0.84) {
      ev(loc.tenantId, personId, "coverage.measure_recorded", at(Math.max(1, startDays - 2)), { instrument: "phq-9" });
    }

    // Care delivered, and whether a human reviewed it.
    const sessions = 1 + Math.floor(rand() * 6);
    for (let s = 0; s < sessions; s++) {
      const d = Math.max(1, startDays - s * 9 - Math.round(rand() * 4));
      ev(loc.tenantId, personId, "coverage.session_delivered", at(d), {});
    }
    if (rand() < 0.71) {
      ev(loc.tenantId, personId, "coverage.reviewed", at(Math.max(1, startDays - 6)), {});
    }

    // A fixed safety gate fired for a minority, and most were responded to.
    if (rand() < 0.061) {
      const gate = Math.max(2, startDays - Math.round(rand() * 30));
      ev(loc.tenantId, personId, "coverage.gate_recorded", at(gate), { rule: "S-04" });
      if (rand() < 0.88) {
        ev(loc.tenantId, personId, "coverage.gate_responded", at(Math.max(1, gate - (rand() < 0.6 ? 0 : 1)), 14), {
          responded: true,
        });
      }
    }

    // Observed outcome status at the end of the window — measured, not
    // predicted. Missing follow-up is left ABSENT rather than recorded as a
    // category, so the outcomes screen has to count it as missing from the
    // denominator instead of being handed a tidy fourth bar.
    if (rand() < 0.879) {
      const q = rand();
      const status = q < 0.62 ? "improved" : q < 0.88 ? "stable" : "worsened";
      ev(loc.tenantId, personId, "outcome.classified", at(Math.max(1, startDays - 30)), { status });
    }
  }
}
