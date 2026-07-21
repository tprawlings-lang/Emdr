// Deterministic safety core — readiness scoring (Autonomous Step 2).
//
// ⚠️ Volume II gives TWO incompatible readiness formulas (ledger A1). We
// implement the multiplier-based Appendix form because BOTH versions agree the
// **caps are the actual safety mechanism**, and the caps are what gate access.
// The precise score→track boundaries are PROVISIONAL pending clinician sign-off;
// the caps are conservative and safe regardless of which formula is ratified.
//
// Pure and side-effect-free.

export interface ReadinessDomains {
  stability: number; // 0–10
  bodySafety: number; // 0–10
  presentConnection: number; // 0–10
  symptomIntensity: number; // 0–10 (higher = worse)
  sleep: number; // 0–10
  support: number; // 0–10
  selfReadiness: number; // 0–10
  pauseCapacity: number; // 0–10
  feelsFullySafe: boolean;
  riskFlag: boolean;
}

export interface ReadinessResult {
  /** Provisional 0–100 score (ledger A1 — formula choice pending sign-off). */
  score: number;
  track: "grounding" | "cautious" | "steady";
  /** Engine-facing caps (these are the real safety mechanism). */
  caps: { riskFlag: boolean; lessThanFullySafe: boolean; pauseCapacityNo: boolean };
}

const clamp10 = (n: number) => Math.max(0, Math.min(10, n));

export function scoreReadiness(d: ReadinessDomains): ReadinessResult {
  // Appendix multiplier form (weights sum to 10 → 0–100 range).
  const raw =
    clamp10(d.stability) * 1.5 +
    clamp10(d.bodySafety) * 1.5 +
    clamp10(d.presentConnection) * 1.0 +
    (10 - clamp10(d.symptomIntensity)) * 1.5 +
    clamp10(d.sleep) * 1.0 +
    clamp10(d.support) * 1.0 +
    clamp10(d.selfReadiness) * 1.5 +
    clamp10(d.pauseCapacity) * 1.0;

  const caps = {
    riskFlag: d.riskFlag === true,
    lessThanFullySafe: d.feelsFullySafe === false,
    // Main body: pause capacity 0–2 → grounding. We treat ≤2 as "cannot pause".
    pauseCapacityNo: clamp10(d.pauseCapacity) <= 2,
  };

  // Apply caps to the score (caps override the formula — never remove a cap to
  // credit other strengths).
  let score = raw;
  if (caps.riskFlag) score = 0;
  if (caps.lessThanFullySafe) score = Math.min(score, 30);
  if (caps.pauseCapacityNo) score = Math.min(score, 60);

  // Provisional track boundaries (Appendix ≤30 / 31–60 / ≥61), mapped to the
  // beta track names (ledger A1).
  const track: ReadinessResult["track"] = score <= 30 ? "grounding" : score <= 60 ? "cautious" : "steady";

  return { score: Math.round(score), track, caps };
}
