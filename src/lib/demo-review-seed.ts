import crypto from "crypto";
import type Database from "better-sqlite3";
import { demoId } from "./demo-seed";
import { demoEpoch } from "./demo-population-calendar";
import { encryptField } from "./crypto";
// VALUES ARE LOADED AT CALL TIME, not at module evaluation — see the note in
// `seedReviewConsole`. These type-only imports are erased by the compiler, so
// they cost nothing at runtime and the file stays fully typed.
import type * as GatesModule from "./review/gates";
import type * as CopyModule from "./review/clinical-copy";

// Review-console state, so the four deciding screens can be walked
// (§26 p44, §31.6 p99).
//
// WITHOUT THIS THE SCREENS ARE HONEST AND USELESS. A reviewer opens the console
// and finds an empty queue and eight undecided gates, which is a true picture of
// a deployment nobody has reviewed and shows none of the behaviour that makes
// the screens worth having. The one thing a demonstration has to convey is what
// happens AFTER a decision — and specifically what happens when the evidence
// under a decision moves.
//
// So the seeded state is chosen to put every state on screen at once:
//
//   A gate signed off against the evidence CURRENTLY on the screen.
//   A gate signed off against evidence that has since changed — which renders
//     as reopened, names the fingerprint it was approved at, and is the whole
//     argument for binding a decision to a version.
//   An attested gate approved with a reference to where its evidence lives.
//   Gates nobody has looked at, which must not resemble any of the above.
//
//   Access requests pending, approved-and-active, approved-and-EXPIRED, and
//     denied with a reason. The expired one matters: an approval whose window
//     has passed is not access, and a demo that only shows "approved" teaches
//     the opposite.
//
//   Clinical copy mostly approved, with the highest-stakes sentence — the
//     safety stop — still under change request, because that is the realistic
//     state and because a screen showing six green rows demonstrates nothing.
//
// DETERMINISM. Ids are derived by hash and timestamps come from the demo
// calendar, never from the clock at seed time, so two resets produce the
// identical baseline hash. Nothing here is idempotent by accident: the seed
// returns early if its own first row is present.

const REVIEW_SEED_VERSION = "review-console-2026-09-v1";

/**
 * The reviewer, and the admin who is the second pair of eyes. Two accounts
 * rather than one, because a request and its decision must come from different
 * people or the screen demonstrates the failure it prevents.
 *
 * FUNCTIONS, NOT CONSTANTS. As top-level constants these called `demoId()`
 * while this module was still evaluating, and the import chain back to
 * demo-seed.ts is circular — so `DEMO_SEED_VERSION` was sometimes not
 * initialized yet and the id threw. It depended on which entry point pulled
 * the module in first: the app build was fine and four test files died on
 * import. Resolving the ids at call time removes the ordering question
 * instead of relying on an import graph staying the shape it is today.
 */
function reviewerId(): string {
  return demoId(5);
}
function adminId(): string {
  return demoId(6);
}

function reviewId(kind: string, key: string): string {
  return crypto
    .createHash("sha256")
    .update(`${REVIEW_SEED_VERSION}:${kind}:${key}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

/** A stable timestamp N days after the start of the demo calendar. */
function at(dayOffset: number): string {
  const d = new Date(demoEpoch().getTime() + dayOffset * 86_400_000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** A date N days from the calendar start, as an ISO instant — used for expiry,
 *  which is compared against the real clock by the screen. */
function expiryAt(dayOffset: number): string {
  return new Date(demoEpoch().getTime() + dayOffset * 86_400_000).toISOString();
}

export function seedReviewConsole(db: Database.Database, platformTenantId: string): void {
  // Own existence check, own table. A shared "has anything been seeded" guard
  // is how new seed material reaches the code and never reaches the one
  // deployed database anybody looks at.
  const already = db.prepare("SELECT 1 FROM access_requests LIMIT 1").get();
  if (already) return;

  // The two accounts these rows point at must exist before anything references
  // them. This runs on EVERY boot, including on databases that were never demo
  // seeded and on one whose accounts are mid-rename — and a seed that assumes
  // its foreign keys are there takes the whole boot down with it when they are
  // not. Skipping is the correct answer: an empty review console is a true
  // statement about a deployment that has no reviewer.
  // THE IMPORT CYCLE, AND WHY THESE ARE LOADED HERE.
  //
  // db.ts calls this function, and the gate registry reaches the identity scan
  // and the data-quality checks, which reach the population generator, which
  // reaches db.ts again. Imported at the top of this file that loop is
  // evaluated during module initialization and something in it is always
  // half-built: the first symptom was `DEMO_SEED_VERSION` being unreadable
  // from inside `demoId`, and the second was `INTAKE_INSTRUMENTS` the same way
  // two modules further along. Both failed on SOME entry points and not
  // others — the app build was clean while four test files died on import,
  // which is the worst version of this bug because the thing you run most
  // often is the thing that hides it.
  //
  // Loading them at CALL time removes the ordering question rather than
  // arranging the imports into a shape that happens to work today. By the time
  // any seed runs, every module in the cycle is fully initialized.
  // The rule is right in general and this is the case it does not cover: a
  // dynamic `import()` would make this function async, and it is called inside
  // a synchronous better-sqlite3 transaction. Scoped to these two lines rather
  // than disabled for the file.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { RELEASE_GATES, resolveEvidence, fingerprint } =
    require("./review/gates") as typeof GatesModule;
  const { reviewableSurfaces, copyVersion } =
    require("./review/clinical-copy") as typeof CopyModule;
  /* eslint-enable @typescript-eslint/no-require-imports */

  const haveActors = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?)")
    .get(reviewerId(), adminId()) as { n: number };
  if (haveActors.n < 2) return;

  const insertRequest = db.prepare(
    `INSERT INTO access_requests (id, tenant_id, requested_by, requested_role, purpose, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertDecision = db.prepare(
    `INSERT INTO review_decisions
       (id, subject_kind, subject_id, subject_version, decision, rationale, evidence_json, actor_id, actor_role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.transaction(() => {
    // ---- Access requests, one per state the screen can show. -------------
    const requests: {
      key: string;
      by: string;
      role: string;
      purpose: string;
      raisedDay: number;
      expiryDay: number;
      decision: "approved" | "blocked" | null;
      decidedBy: string;
      decidedRole: string;
      decidedDay: number;
      rationale: string | null;
    }[] = [
      {
        key: "pending-clinical-audit",
        by: adminId(),
        role: "clinician",
        purpose:
          "Reviewing the safety-stop copy against three sessions where the gate fired, to check the wording matches what actually happened.",
        raisedDay: 352,
        expiryDay: 380,
        decision: null,
        decidedBy: "",
        decidedRole: "",
        decidedDay: 0,
        rationale: null,
      },
      {
        key: "active-org-reporting",
        by: adminId(),
        role: "organization",
        purpose: "Quarterly access-and-start reporting for the Northeast sites.",
        raisedDay: 330,
        expiryDay: 420,
        decision: "approved",
        decidedBy: reviewerId(),
        decidedRole: "reviewer",
        decidedDay: 331,
        rationale: null,
      },
      {
        key: "expired-payer-lookback",
        by: adminId(),
        role: "payer",
        purpose: "One-off contract measure lookback for the completed plan year.",
        raisedDay: 200,
        // Deliberately in the past. An approval whose window has closed is not
        // access, and the screen has to say so rather than showing it green.
        expiryDay: 260,
        decision: "approved",
        decidedBy: reviewerId(),
        decidedRole: "reviewer",
        decidedDay: 201,
        rationale: null,
      },
      {
        key: "denied-broad-clinical",
        by: adminId(),
        role: "clinician",
        purpose: "General access to member records to explore engagement patterns.",
        raisedDay: 300,
        expiryDay: 400,
        decision: "blocked",
        decidedBy: reviewerId(),
        decidedRole: "reviewer",
        decidedDay: 301,
        rationale:
          "The purpose does not name a person, a question or a bounded set. Exploring engagement patterns is a cohort question and the research workspace answers it without reaching a record.",
      },
    ];

    for (const r of requests) {
      const id = reviewId("access-request", r.key);
      const expires = expiryAt(r.expiryDay);
      insertRequest.run(
        id,
        platformTenantId,
        r.by,
        r.role,
        encryptField(r.purpose),
        expires,
        at(r.raisedDay)
      );
      if (r.decision) {
        insertDecision.run(
          reviewId("access-decision", r.key),
          "access_request",
          id,
          // Bound to what was asked for, so an edited request cannot inherit
          // this answer.
          `${r.role}@${expires}`,
          r.decision,
          r.rationale ? encryptField(r.rationale) : null,
          JSON.stringify({ requestedRole: r.role, expiresAt: expires }),
          r.decidedBy,
          r.decidedRole,
          at(r.decidedDay)
        );
      }
    }

    // ---- Clinical language, mostly reviewed. -----------------------------
    // Written BEFORE the gate fingerprints are computed, because the clinical
    // language gate reads this tally — its fingerprint has to be taken over
    // the state the screen will actually show.
    const version = copyVersion();
    for (const s of reviewableSurfaces()) {
      // The safety stop stays under change request. It is the sentence a
      // member reads at the hardest moment, it is the one most likely to be
      // still moving, and a console where every row is green demonstrates
      // nothing about what this screen is for.
      const underReview = s.id === "gate.safety_stop";
      insertDecision.run(
        reviewId("clinical", s.id),
        "clinical_language",
        s.id,
        version,
        underReview ? "changes_requested" : "approved",
        underReview
          ? encryptField(
              "“Stopped because continuing was not the safe choice” reads as a judgement about the member. Rewrite so the sentence is about the system's decision, not about them."
            )
          : null,
        JSON.stringify({ copyVersion: version }),
        reviewerId(),
        "reviewer",
        at(345)
      );
    }

    // ---- Release gates. --------------------------------------------------
    const evidence = resolveEvidence(db, {
      clinicalLanguage: {
        total: reviewableSurfaces().length,
        approved: reviewableSurfaces().length - 1,
        blocked: 0,
        changesRequested: 1,
      },
    });

    const signoffs: { gate: string; stale: boolean; evidenceRef: string | null; day: number }[] = [
      // Signed off against the evidence the screen is showing now.
      { gate: "safety_regression", stale: false, evidenceRef: null, day: 350 },
      // Signed off against evidence that has since moved. This is the state
      // the whole design exists to make visible, and the demo is poorer
      // without it on screen.
      { gate: "demo_identity", stale: true, evidenceRef: null, day: 312 },
      // An attestation, with the pointer the action requires.
      {
        gate: "accessibility",
        stale: false,
        evidenceRef: "Manual keyboard and screen-reader pass, review environment, recorded in the QA log",
        day: 348,
      },
    ];

    for (const s of signoffs) {
      const gate = RELEASE_GATES.find((g) => g.id === s.gate);
      if (!gate) continue;
      const ev = evidence.get(s.gate);
      if (!ev) continue;
      const current = fingerprint(ev.facts);
      // A recorded fingerprint that no longer matches — which is exactly what a
      // real one looks like once the evidence under it has changed.
      const version = s.stale
        ? fingerprint({ ...ev.facts, __supersededAt: "earlier-scan" })
        : current;
      insertDecision.run(
        reviewId("gate", s.gate),
        "release_gate",
        s.gate,
        version,
        "approved",
        null,
        JSON.stringify({
          fingerprint: version,
          evidenceClass: gate.evidenceClass,
          evidenceRef: s.evidenceRef,
        }),
        reviewerId(),
        "reviewer",
        at(s.day)
      );
    }
  })();
}
