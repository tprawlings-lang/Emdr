# Load, stress & resilience testing

## Tooling
[k6](https://k6.io) — `steady-load.js` in this directory. Run against
**staging**, never production (the check-in path writes rows).

```bash
BASE=https://staging.example.com EMAIL=... PASS=... k6 run docs/load-test/steady-load.js
```

## Method
1. **Baseline:** ramp 0→100 VUs over ~3 min (the script's default). Record
   `http_req_duration` p95/p99, `http_req_failed`, and throughput.
2. **Stress:** raise the top stage (200, 400, …) until error rate crosses 1% or
   p99 crosses 2s. That inflection is the **discovered ceiling** for one
   instance — record it here.
3. **Soak:** hold ~60% of the ceiling for 30 min to surface leaks (watch RSS,
   the rate-limiter map, SQLite WAL size).

## Discovered thresholds

First run captured **2026-07** with `autocannon` against a **local production
build** (`npm run build && npm run start`, `EMDR_DEMO=1`) on the hot read path
(`GET /`, server-rendered). Ramp by concurrent connections:

| Connections | Throughput | p50 | p97.5 | p99 | Errors |
|---|---|---|---|---|---|
| 50  | ~140 req/s | 340 ms | 494 ms | 514 ms | 0 |
| 100 | ~150 req/s | 643 ms | 800 ms | 804 ms | 0 |
| 200 | ~150 req/s | 1283 ms | 1649 ms | 1653 ms | 0 |
| 400 | ~140 req/s | 1567 ms | 1698 ms | 3563 ms | **150 timeouts** |

**Interpretation.** Throughput saturates at **~150 req/s** for the render path;
adding concurrency past that only grows the queue (latency climbs, throughput
flat). The **single-instance ceiling** is ~200 in-flight requests — p99
approaches the 2 s budget there and, past ~400 in-flight, the server sheds load
as timeouts. Baseline gate: **p99 < 2000 ms and error rate < 1 % at 50
concurrent connections** (observed p99 ≈ 455–514 ms, 0 errors).

> ⚠️ These numbers are from a local build on CI-class hardware, **not** the
> deployed Render **starter** instance (0.5 CPU / 512 MB), which will be
> lower. Treat them as a regression baseline and re-run `k6` against a real
> staging instance to set production capacity numbers.

## CI enforcement (implemented)

`scripts/loadcheck.mjs` fires `autocannon` at an already-running server and
**exits non-zero if p99 or error rate breaches the gate** (defaults: p99 <
2000 ms, error rate < 1 %; override via `MAX_P99_MS` / `MAX_ERROR_RATE` /
`CONNECTIONS` / `DURATION`). The **nightly `load` CI job**
(`.github/workflows/load.yml`) builds the app, starts it, and runs
`npm run loadcheck` — a threshold breach fails the run. It is scheduled (not
per-PR) because load runs are slow and shared-runner-noisy. The higher-fidelity
`steady-load.js` (k6) remains the tool for ramp/stress/soak against staging;
tighten its `thresholds` block to the staging-discovered numbers when a staging
target exists.

## Known architectural ceiling
Steady is single-instance (ADR 0004). Vertical scaling (bigger instance) is the
only lever until the app moves to Postgres + shared rate-limit store. The load
test measures *one instance*; capacity plan against that number.

## Resilience / chaos (manual until automated)
- **Model outage:** unset `ANTHROPIC_API_KEY` on staging — the companion must
  fall back to the rules engine and crisis regex must still fire. (Covered in
  spirit by the `@safety` suite.)
- **Kill switch:** set `EMDR_DISABLE_NEW_SESSIONS=1` — no new sessions start,
  grounding/companion stay up.
- **Backup target down:** point R2 creds at a bad bucket — nightly backup must
  email `BACKUP_ALERT_EMAIL` and not crash the app.
- **DB restore:** `make restore-test` (see docs/disaster-recovery.md).
