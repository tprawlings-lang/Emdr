import type Database from "better-sqlite3";
import crypto from "crypto";
import { NIL_ULID as PLATFORM_TENANT_ID } from "./ids";

// The fabricated contracted population behind the payer screens
// (§26's ten payer screens, §29's payer charts p82–p83).
//
// Same reasoning as the organization seed: the screens report on a contracted
// population using claims, so there has to be one, and it is seeded as ROWS —
// members, eligibility, individual claims with their own dates — rather than
// as the totals a chart wants. Every figure on a payer screen is counted.
//
// THE ONE THING THIS SEED EXISTS TO MAKE REAL is claims lag. A claim is
// incurred on one date and arrives weeks later. That single fact is why:
//
//   - the most recent two months of any utilisation trend are INCOMPLETE, and
//     a chart that ignores it draws utilisation falling at the right-hand edge
//     every single time, for every payer, purely because the post has not
//     arrived;
//   - a "savings" claim read off that edge is the most expensive mistake this
//     product could help someone make.
//
// So claims here carry `incurred_at` and `received_at` separately, with a
// realistic spread, and a slice of them are still pending or were corrected.
// The screens then have something true to be careful about.

export const PAYER_SEED_VERSION = "payer-2026-08-v1";

export function payerId(n: number, version = PAYER_SEED_VERSION): string {
  const h = crypto.createHash("sha256").update(`${version}:${n}`).digest("hex");
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join("-");
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export const PAYER_TENANT_ID = payerId(0);
export const PAYER_NAME = "Meridian Health Plan";
export const CONTRACT_ID = payerId(1);

/** Covered lives under the contract. */
export const PAYER_POPULATION = 12480;

/** Days of claims lag: median around 60, with a long tail. Stated on the
 *  contract so a reader can compare observed lag against expected. */
export const EXPECTED_LAG_DAYS = 60;

export function seedPayerData(db: Database.Database) {
  db.transaction(() => seedPayerInner(db))();
}

function seedPayerInner(db: Database.Database) {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM tenants WHERE id = ?").get(PAYER_TENANT_ID) as { n: number };
  if (existing.n > 0) return;

  db.prepare(
    `INSERT INTO tenants (id, kind, name) VALUES (?, 'platform', 'Steady Platform')
     ON CONFLICT(id) DO NOTHING`,
  ).run(PLATFORM_TENANT_ID);

  const at = (daysAgo: number) => {
    const t = new Date(Date.now() - daysAgo * 86400000);
    t.setUTCHours(9, 0, 0, 0);
    while (t.getTime() > Date.now()) t.setUTCDate(t.getUTCDate() - 1);
    return t;
  };
  const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
  const day = (d: Date) => d.toISOString().slice(0, 10);

  db.prepare(
    "INSERT INTO tenants (id, kind, name, parent_tenant_id, created_at) VALUES (?, 'organization', ?, ?, ?)",
  ).run(PAYER_TENANT_ID, PAYER_NAME, PLATFORM_TENANT_ID, sql(at(700)));

  // ── The contract, and the measures it is judged against ──────────────────
  db.prepare(
    `INSERT INTO payer_contracts (id, tenant_id, name, cohort_version, period_start, period_end, claims_lag_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    CONTRACT_ID, PAYER_TENANT_ID, "Behavioral health access and utilisation, 2026",
    "cohort.v3", day(at(365)), day(at(-1)), EXPECTED_LAG_DAYS,
  );

  const insertMeasure = db.prepare(
    `INSERT INTO contract_measures (id, contract_id, metric, label, target_value, unit, better)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let mseq = 100;
  for (const m of [
    ["engaged_rate", "Members who started care", 65, "% of eligible", "higher"],
    ["followup_rate", "Follow-up within 30 days", 70, "% of those who started", "higher"],
    ["ed_per_1000", "ED visits per 1,000 eligible members", 9.0, "per 1,000 / month", "lower"],
    ["inpatient_per_1000", "Inpatient admissions per 1,000", 2.5, "per 1,000 / month", "lower"],
    ["time_to_care_days", "Median days referral to care start", 21, "days", "lower"],
  ] as const) {
    insertMeasure.run(payerId(mseq++), CONTRACT_ID, m[0], m[1], m[2], m[3], m[4]);
  }

  // ── The cost model: three scenarios, one approved version ────────────────
  //
  // The renders draw Conservative / Expected / Upper, each with its own range
  // and point estimate. The statuses matter as much as the numbers: a draft
  // and an approved model must not render alike, and the superseded row stays
  // so an older report can be reproduced.
  const insertModel = db.prepare(
    `INSERT INTO cost_model_versions
       (id, tenant_id, model_version, scenario, low, point, high, unit, status, assumptions_json, approved_by, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PMPM', ?, ?, ?, ?)`,
  );
  const ASSUMPTIONS = JSON.stringify([
    "Engagement holds at the observed rate for the remainder of the period.",
    "Avoided ED visits are valued at the plan's average allowed amount, not billed charges.",
    "No case-mix adjustment; the comparison cohort is the prior year's eligible population.",
    "Claims incurred in the last 60 days are excluded as incomplete.",
  ]);
  let vseq = 200;
  for (const [scenario, low, point, high] of [
    ["Conservative", 1, 4, 7],
    ["Expected", 5, 8, 13],
    ["Upper", 4, 14, 20],
  ] as const) {
    insertModel.run(
      payerId(vseq++), PAYER_TENANT_ID, "cost-model.v2", scenario, low, point, high,
      "approved", ASSUMPTIONS, "Actuarial review (fictional)", sql(at(40)),
    );
  }
  // A superseded predecessor, so the screen can show that estimates move and
  // that the old one is still readable.
  insertModel.run(
    payerId(vseq++), PAYER_TENANT_ID, "cost-model.v1", "Expected", 6, 11, 17,
    "superseded", ASSUMPTIONS, "Actuarial review (fictional)", sql(at(190)),
  );

  // ── Covered lives, eligibility, and claims ───────────────────────────────
  const insertPerson = db.prepare(
    "INSERT INTO persons (id, tenant_id, display_name, created_at) VALUES (?, ?, NULL, ?)",
  );
  const insertEnrollment = db.prepare(
    `INSERT INTO enrollments (id, person_id, tenant_id, program_id, eligibility, effective_from, created_at)
     VALUES (?, ?, ?, 'behavioral-health', 'covered', ?, ?)`,
  );
  const insertClaim = db.prepare(
    `INSERT INTO claims (id, tenant_id, person_id, claim_type, incurred_at, received_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const rand = rng(20260829);
  let seq = 1000;

  // Per-member-per-month rates, chosen so the observed series sits near the
  // contract targets rather than comfortably inside them — a demo where every
  // measure passes demonstrates nothing about a report that has to show a miss.
  const ED_PER_1000_MONTH = 8.6;
  const IP_PER_1000_MONTH = 2.3;
  const MONTHS = 12;

  const people: string[] = [];
  for (let i = 0; i < PAYER_POPULATION; i++) {
    const pid = payerId(seq++);
    const enrolledDaysAgo = 30 + Math.floor(rand() * 700);
    insertPerson.run(pid, PAYER_TENANT_ID, sql(at(enrolledDaysAgo)));
    insertEnrollment.run(payerId(seq++), pid, PAYER_TENANT_ID, sql(at(enrolledDaysAgo)), sql(at(enrolledDaysAgo)));
    people.push(pid);
  }

  const claimFor = (type: string, monthsAgo: number) => {
    // A service date somewhere inside that month.
    const incurredDaysAgo = Math.round(monthsAgo * 30 + rand() * 29);
    const incurred = at(incurredDaysAgo);

    // Lag: roughly log-normal around the expected 60 days, with a tail. A
    // claim whose received date is in the future has not arrived — that is
    // precisely what makes the recent months incomplete, so those rows are
    // written as pending rather than dropped.
    const lag = Math.max(3, Math.round(EXPECTED_LAG_DAYS * (0.35 + rand() * 1.6)));
    const receivedDaysAgo = incurredDaysAgo - lag;
    const arrived = receivedDaysAgo >= 0;

    const r = rand();
    const status = !arrived ? "pending" : r < 0.03 ? "rejected" : r < 0.06 ? "corrected" : "accepted";

    insertClaim.run(
      payerId(seq++), PAYER_TENANT_ID, people[Math.floor(rand() * people.length)], type,
      sql(incurred), arrived ? sql(at(receivedDaysAgo)) : sql(at(0)), status,
    );
  };

  // ── Care-pathway events for the contracted population ────────────────────
  //
  // A plan that contracts with Steady sees who engaged, not only who claimed.
  // These use the same event types as the organization seed so the pathway
  // helpers are shared rather than reimplemented per role — the funnel is the
  // same shape whoever is reading it.
  const insertEvent = db.prepare(
    `INSERT INTO longitudinal_events
       (id, tenant_id, person_id, event_type, payload_version, payload, actor_id, actor_type,
        occurred_at, recorded_at, source_system, provenance)
     VALUES (?, ?, ?, ?, 1, '{}', NULL, 'integration', ?, ?, 'eligibility-feed', ?)`,
  );
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let evSeq = 0;
  const ulidAt = (ms: number) => {
    let t = "";
    let v = ms;
    for (let i = 0; i < 10; i++) { t = B32[v % 32] + t; v = Math.floor(v / 32); }
    const h = crypto.createHash("sha256").update(`${PAYER_SEED_VERSION}:e:${evSeq++}`).digest();
    let r = "";
    for (let i = 0; i < 16; i++) r += B32[h[i] % 32];
    return t + r;
  };
  const provenance = JSON.stringify({ feed: "eligibility-feed", fabricated: true });
  const ev = (pid: string, type: string, when: Date) => {
    const ts = sql(when);
    insertEvent.run(ulidAt(when.getTime()), PAYER_TENANT_ID, pid, type, ts, ts, provenance);
  };

  for (const pid of people) {
    const referredDaysAgo = 20 + Math.floor(rand() * 330);
    ev(pid, "referral.received", at(referredDaysAgo));
    if (rand() > 0.86) continue;
    const contactDays = Math.max(1, referredDaysAgo - Math.round(4 + rand() * 20));
    ev(pid, "contact.made", at(contactDays));
    if (rand() > 0.79) continue;
    const startDays = Math.max(1, contactDays - Math.round(5 + rand() * 22));
    ev(pid, "care.started", at(startDays));
    // Follow-up within 30 days is a contract measure, so it is an event
    // rather than an inference from session counts.
    if (rand() < 0.73) ev(pid, "coverage.session_delivered", at(Math.max(1, startDays - Math.round(rand() * 28))));
    if (rand() < 0.88) {
      const q = rand();
      ev(pid, "outcome.classified", at(Math.max(1, startDays - 30)));
      void q;
    }
  }

  for (let m = 0; m < MONTHS; m++) {
    const ed = Math.round((PAYER_POPULATION / 1000) * ED_PER_1000_MONTH * (0.88 + rand() * 0.24));
    const ip = Math.round((PAYER_POPULATION / 1000) * IP_PER_1000_MONTH * (0.85 + rand() * 0.3));
    for (let i = 0; i < ed; i++) claimFor("ed_visit", m);
    for (let i = 0; i < ip; i++) claimFor("inpatient_admit", m);
  }
}
