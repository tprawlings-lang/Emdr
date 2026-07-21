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

## Discovered thresholds (fill in after the first staging run)
| Metric | Baseline (100 VU) | Ceiling |
|---|---|---|
| p95 latency | _TBD_ | _TBD_ |
| p99 latency | _TBD_ | _TBD_ |
| error rate | _TBD_ | _TBD_ |
| single-instance VU ceiling | — | _TBD_ |

Once filled in, tighten the `thresholds` block in `steady-load.js` to the
discovered numbers and add a **nightly CI job** (against staging) that runs the
script and fails on threshold breach — that is the CI enforcement of the gate.

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
