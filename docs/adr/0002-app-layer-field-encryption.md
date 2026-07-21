# 0002 — App-layer AES-256-GCM field encryption + fail-fast secrets

**Status:** Accepted

## Context
SQLite has no native column encryption. Member free text (chat, notes, safety
plan, screener answers) is the most sensitive data we hold. A database dump or
stolen backup must not expose it.

## Decision
Encrypt sensitive fields at the application layer with AES-256-GCM
(`src/lib/crypto.ts`), key from `EMDR_DATA_KEY`, `enc1:` prefix, random 96-bit
IV per value, auth tag verified on read (fail-closed). Backups are additionally
age-encrypted (`docs/backups.md`).

The failure mode — a missing key silently storing plaintext — is closed by a
**production boot guard** (`src/lib/env-guard.ts`, run from
`instrumentation.ts`) that refuses to start if `EMDR_DATA_KEY` (or a real
`EMDR_SESSION_SECRET`) is absent in production.

## Consequences
- Encrypted columns are not queryable by content (acceptable; we never query on
  free text).
- Key rotation requires a re-encrypt migration (not yet built — future work).
