// What a gate resolved to, the last time anybody asked.
//
// TWO GATES COULD NOT BE PART OF THE PILOT CHECK WITHOUT THIS.
// `clinical_language` and `projection_parity` read `unavailable` in every
// deployment — not because they fail, but because `resolveEvidence` does not
// compute either unless the caller hands it in: one needs the copy-review
// tally the review screen holds, the other a ledger rebuild that is
// deliberately not run on a page load. The environment tier is read on the
// signup page, so asking for either there would be free and wrong or correct
// and unaffordable — and requiring them anyway would close enrollment
// permanently, which is the one-way door this codebase has now walked into
// twice.
//
// EXPIRES ON CHANGE, NOT ON A CLOCK. Decided 23 September. Each record carries
// the BASIS it was resolved against and counts only while that still matches.
// A time cap was considered and rejected: a result that expires on a timer
// closes the pilot tier overnight with nothing having changed, which teaches
// an operator to re-run a check they have no reason to believe is stale — and
// a check somebody re-runs without reading is worse than no check.
//
// THE BASIS IS NEVER DERIVED FROM THE RESULT, and that sentence is here
// because getting it wrong once cost a real debugging session: a gate's
// sign-off state was briefly folded into the facts its fingerprint is computed
// from, so recording an approval changed the thing the approval was keyed on,
// and the signature invalidated itself by existing. A basis must be something
// that identifies the INPUTS and is computable without doing the work.

import { data } from "../data";
import { copyVersion } from "../review/clinical-copy";
import { versionReport } from "../version";

/** The gates this record exists for, and what identifies their inputs. */
export const RECORDED_GATES: readonly string[] = ["clinical_language", "projection_parity"];

export interface RecordedResult {
  gateId: string;
  basis: string;
  status: "pass" | "fail" | "unavailable";
  summary: string;
  resolvedAt: string;
}

/**
 * What identifies this gate's inputs right now.
 *
 * EXACT FOR ONE, APPROXIMATE FOR THE OTHER, and the difference is worth
 * stating rather than smoothing over. The clinical-language gate reads the
 * copy decisions, and `copyVersion()` is precisely the version those decisions
 * are recorded against — so a recorded result expires exactly when it should.
 * Projection parity compares a rebuilt ledger against the live one, and
 * nothing cheap identifies ledger state; the deployed commit is the closest
 * honest stand-in, and it is a WEAKER claim: it expires when the code changes,
 * not when the data does.
 */
export function basisFor(gateId: string, generation?: string | null): string | null {
  switch (gateId) {
    case "clinical_language":
      return `copy:${copyVersion()}`;
    case "projection_parity": {
      const v = versionReport();
      if (v.commitShort) return `build:${v.commitShort}`;
      // A BUILD THAT REPORTS NO COMMIT IS NOT A DEAD END, and treating it as
      // one was a third one-way door — found by the enrollment suite going red
      // on a fresh database. `scripts/serve.sh` derives the commit from git, so
      // a served build has one; `npm run start` does not, and neither does any
      // deployment whose image forgot to bake it in. Returning null there meant
      // parity could never be recorded, so the gate could never pass, so
      // enrollment could never open — in exactly the deployments least likely
      // to notice why.
      //
      // The environment GENERATION is the better basis anyway, and it is a
      // shame it is the fallback rather than the answer: parity asks whether a
      // rebuild reproduces what the screens show, and the generation changes
      // precisely when the data underneath is rebuilt. The commit is the
      // weaker signal — it expires when the code changes, not when the data
      // does — and it is kept first only because it is available without an
      // async read where most callers are.
      return generation ? `gen:${generation}` : null;
    }
    default:
      return null;
  }
}

/** Write what a gate resolved to, for a reader who cannot afford to recompute it. */
async function generationId(): Promise<string | null> {
  try {
    const { currentGeneration } = await import("../environment-generation");
    return (await currentGeneration()).generation;
  } catch {
    return null;
  }
}

export async function recordGateResult(args: {
  gateId: string;
  status: "pass" | "fail" | "unavailable";
  summary: string;
  now?: Date;
}): Promise<boolean> {
  const basis = basisFor(args.gateId, await generationId());
  if (!basis) return false;
  // AN `unavailable` RESULT IS NOT RECORDED. It means nobody resolved it, and
  // storing that would turn "we did not look" into a durable finding that
  // survives until the inputs move — the opposite of what this table is for.
  if (args.status === "unavailable") return false;

  const at = (args.now ?? new Date()).toISOString().replace("T", " ").slice(0, 19);
  const c = await data();
  await c.run(
    `INSERT INTO gate_results (gate_id, basis, status, summary, resolved_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(gate_id, basis) DO UPDATE SET
       status = excluded.status, summary = excluded.summary, resolved_at = excluded.resolved_at`,
    [args.gateId, basis, args.status, args.summary, at]
  );
  return true;
}

/**
 * Results that still count, keyed by gate.
 *
 * SELECTED ON THE CURRENT BASIS rather than read-then-compared, so a result
 * recorded against inputs that have since moved is simply not returned. There
 * is no state in which a stale row is in hand and something has to remember
 * not to trust it.
 */
export async function currentGateResults(): Promise<Map<string, RecordedResult>> {
  const out = new Map<string, RecordedResult>();
  const c = await data();
  const gen = await generationId();
  for (const gateId of RECORDED_GATES) {
    const basis = basisFor(gateId, gen);
    if (!basis) continue;
    const row = (await c.get(
      `SELECT gate_id, basis, status, summary, resolved_at
         FROM gate_results WHERE gate_id = ? AND basis = ?`,
      [gateId, basis]
    )) as Record<string, string> | undefined;
    if (!row) continue;
    out.set(gateId, {
      gateId: row.gate_id, basis: row.basis,
      status: row.status as RecordedResult["status"],
      summary: row.summary, resolvedAt: row.resolved_at,
    });
  }
  return out;
}
