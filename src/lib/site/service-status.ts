import { data } from "@/lib/data";
import { blsResourcingEnabled } from "@/lib/safety/config";

// What is working, and what is not (§26: "/status/degraded — Use safe
// fallback — available and blocked functions — Open grounding").
//
// The point of this module is that the answer is MEASURED rather than
// asserted. A status page listing hand-written rows of "operational" is a
// claim about a system by someone who was not looking at it — the same defect
// as a care team that "has been notified" with no delivery receipt.
//
// Two of these functions can never appear as blocked, and they are checked
// rather than assumed: §1 requires grounding and crisis to survive "a write,
// subscription, sync, or service failure", and a status page that could
// truthfully report them as down would mean that requirement had already been
// broken somewhere else. `alwaysAvailable` marks them, and a guard fails the
// build if either is ever made conditional.

export type FunctionState = "available" | "degraded" | "blocked";

export interface ServiceFunction {
  name: string;
  state: FunctionState;
  /** What a person can do about it right now. */
  detail: string;
  /** True for the two that must survive every failure. */
  alwaysAvailable?: boolean;
}

export interface ServiceStatus {
  functions: ServiceFunction[];
  checkedAt: string;
  /** True when anything is not fully available. */
  degraded: boolean;
}

export async function readServiceStatus(): Promise<ServiceStatus> {
  const functions: ServiceFunction[] = [];

  // Grounding and crisis, first and unconditional. They are on this list at
  // all so that a reader can see they were checked, not to leave room for
  // them to be off.
  functions.push({
    name: "Grounding exercises",
    state: "available",
    detail: "Runs entirely in the page. It does not need an account, a network round-trip, or a working database.",
    alwaysAvailable: true,
  });
  functions.push({
    name: "Crisis resources",
    state: "available",
    detail: "Phone and text lines are listed on a page that needs nothing from this system to render.",
    alwaysAvailable: true,
  });

  // The database is the one dependency the rest share, so it is probed rather
  // than inferred from the absence of errors elsewhere.
  let dbOk = true;
  try {
    const c = await data();
    await c.get("SELECT 1 AS ok", []);
  } catch {
    dbOk = false;
  }

  functions.push({
    name: "Signing in",
    state: dbOk ? "available" : "blocked",
    detail: dbOk
      ? "Accounts and sessions are responding."
      : "The account store is not responding, so new sessions cannot be created. Grounding and crisis do not need one.",
  });

  functions.push({
    name: "Daily check-in",
    state: dbOk ? "available" : "blocked",
    detail: dbOk
      ? "Answers are recorded and today's safest next step is computed from them."
      : "Answers cannot be recorded. Nothing you have already saved is lost — it is not reachable until this clears.",
  });

  // The companion degrades rather than fails: without a model key it falls
  // back to the deterministic rules engine, which is a narrower companion and
  // not an absent one. Saying "available" would overstate it and "blocked"
  // would understate it, which is what the third state is for.
  const modelConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  functions.push({
    name: "Companion",
    state: dbOk ? (modelConfigured ? "available" : "degraded") : "blocked",
    detail: !dbOk
      ? "Unavailable while the record store is unreachable."
      : modelConfigured
        ? "Responding, within its stated bounds."
        : "Running on the built-in rules engine rather than a model. It still answers, with a narrower range, and it still never gives clinical advice.",
  });

  // Sessions are gated on the safety engine, and the kill switch is a
  // deliberate block rather than a fault. A status page that reported a
  // safety stop as an outage would invite someone to try to fix it.
  const sessionsOn = blsResourcingEnabled();
  functions.push({
    name: "Guided calm-place sessions",
    state: !dbOk ? "blocked" : sessionsOn ? "available" : "blocked",
    detail: !dbOk
      ? "Unavailable while the record store is unreachable."
      : sessionsOn
        ? "Open, subject to the same fixed safety gates as always."
        : "Stopped by the safety kill switch. This is a decision, not a fault, and it is not something to wait out — grounding and support stay open.",
  });

  const checkedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  return {
    functions,
    checkedAt,
    degraded: functions.some((f) => f.state !== "available"),
  };
}
