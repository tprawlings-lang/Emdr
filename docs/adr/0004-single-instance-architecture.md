# 0004 — Single-instance runtime

**Status:** Accepted

## Context
The SQLite file lives on the web service's persistent disk, and the nightly
backup scheduler runs in-process (`src/instrumentation.ts`) because a separate
cron service can't mount that disk. The companion rate limiter is also in
memory.

## Decision
Run **one** app instance. Concurrency within it is safe: better-sqlite3 is
synchronous (serialized writes) and WAL is enabled.

## Consequences
- Horizontal scale-out is **not** currently supported. Moving to multiple
  instances requires: (a) Postgres or LiteFS/Turso instead of local SQLite,
  (b) a shared rate-limit store (Redis), (c) an external scheduler for backups.
- This is the single largest scaling constraint; revisit when sustained
  concurrency approaches the load-test ceiling (`docs/load-test/`).
