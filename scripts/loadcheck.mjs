// CI load gate. Fires autocannon at an already-running server and fails
// (exit 1) if the discovered thresholds are breached. Used by the nightly
// `load` CI job; the higher-fidelity k6 script (docs/load-test/steady-load.js)
// is for ramp/stress/soak against a real staging instance.
//
//   BASE=http://127.0.0.1:3000 CONNECTIONS=50 DURATION=20 node scripts/loadcheck.mjs
//
// Thresholds are the discovered single-instance baseline (see
// docs/load-test/README.md), kept conservative so the gate catches regressions
// without flaking on shared CI runners.
import autocannon from "autocannon";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const CONNECTIONS = Number(process.env.CONNECTIONS || 50);
const DURATION = Number(process.env.DURATION || 20);
const MAX_P99_MS = Number(process.env.MAX_P99_MS || 2000);
const MAX_ERROR_RATE = Number(process.env.MAX_ERROR_RATE || 0.01);

const result = await autocannon({
  url: BASE,
  connections: CONNECTIONS,
  duration: DURATION,
});

const total = result.requests.total || 0;
const failed = (result.non2xx || 0) + (result.errors || 0) + (result.timeouts || 0);
const errorRate = total > 0 ? failed / total : 1;
const p99 = result.latency.p99;
const p95 = result.latency.p97_5; // autocannon reports p97.5, not p95
const rps = result.requests.average;

console.log(
  `load: ${CONNECTIONS} conns / ${DURATION}s -> ${total} reqs, ${rps.toFixed(0)} req/s, ` +
    `p50 ${result.latency.p50}ms, p97.5 ${p95}ms, p99 ${p99}ms, ` +
    `${failed} failed (${(errorRate * 100).toFixed(2)}%)`
);

const breaches = [];
if (p99 > MAX_P99_MS) breaches.push(`p99 ${p99}ms > ${MAX_P99_MS}ms`);
if (errorRate > MAX_ERROR_RATE)
  breaches.push(`error rate ${(errorRate * 100).toFixed(2)}% > ${(MAX_ERROR_RATE * 100).toFixed(2)}%`);

if (breaches.length) {
  console.error("LOAD GATE FAILED:\n  - " + breaches.join("\n  - "));
  process.exit(1);
}
console.log("LOAD GATE PASSED");
