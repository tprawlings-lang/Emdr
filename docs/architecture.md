# Architecture

Companion to the prose in the README and the decision records in
[`docs/adr/`](adr/). Diagrams render on GitHub (mermaid).

## System context

```mermaid
flowchart TB
  member([Member / Clinician<br/>browser])
  subgraph render[Render — single web service, Docker]
    app[Next.js App Router<br/>Server Actions + RSC<br/>server.js standalone]
    disk[(Persistent disk<br/>/data — SQLite, WAL)]
  end
  anthropic[Anthropic API<br/>Claude — AI companion]
  r2[(Cloudflare R2<br/>age-encrypted backups)]
  resend[Resend<br/>failure-alert email]

  member -->|HTTPS / TLS at edge| app
  app <-->|prepared statements| disk
  app -.->|optional; falls back to<br/>deterministic rules engine| anthropic
  app -.->|nightly cron| r2
  app -.->|on backup failure| resend
```

Dashed edges are optional integrations: without them the app still runs
(companion degrades to the built-in rules engine; backups/alerts stay off,
logged at boot). See ADR&nbsp;0004 for why this is a single instance.

## Request / trust flow

```mermaid
sequenceDiagram
  actor U as Browser
  participant A as Server Action
  participant Z as Authz (requireUser/Member/Clinician)
  participant V as Validate + clamp input
  participant DB as SQLite (scoped to user.id)
  participant AU as Audit chain

  U->>A: FormData / typed args
  A->>Z: resolve session (HMAC cookie, epoch check)
  Z-->>A: user or redirect(/login)
  A->>V: whitelist / length-clamp
  V-->>A: safe values
  A->>DB: parameterized query WHERE user_id = ?
  A->>AU: coded, content-free event (safety/clinician access)
  A-->>U: revalidatePath + redirect
```

## Data at rest

```mermaid
flowchart LR
  input[Member free text<br/>chat, notes, safety plan,<br/>screener answers]
  enc{{AES-256-GCM<br/>EMDR_DATA_KEY<br/>crypto.ts}}
  gate[Risk flags / coded outcomes<br/>stored in clear for gating]
  db[(SQLite /data)]
  audit[Hash-chained audit log<br/>prev_hash → entry_hash]

  input --> enc --> db
  input -->|derive only| gate --> db
  db --> audit
```

A database dump alone never exposes member-entered content (compliance 2.4);
only coded risk flags needed for gating are stored in the clear. The audit log
is append-only and tamper-evident — `verifyAuditChain()` recomputes the chain.

## Backup & disaster recovery

```mermaid
flowchart LR
  db[(SQLite /data)] -->|nightly, BACKUP_HOUR_UTC| snap[Consistent snapshot]
  snap -->|age encrypt<br/>BACKUP_AGE_RECIPIENT| enc[Encrypted blob]
  enc -->|upload, 30-day prune| r2[(Cloudflare R2)]
  enc -.->|on failure| alert[Resend alert email]
  r2 -->|make restore-test| restore[Restore drill<br/>RPO 24h · RTO ~1h]
```

See [`docs/backups.md`](backups.md) and
[`docs/disaster-recovery.md`](disaster-recovery.md). The age **secret** key is
never present on the server — only the public recipient key is.

## Why single-instance

The in-memory rate limiter and the single-writer audit-chain assumption
(`audit.ts`) are only correct with one writer. Horizontal scaling therefore
requires Postgres + a shared rate-limit store first; this is a deliberate,
documented ceiling (ADR&nbsp;0004), acceptable for the current launch scale and
revisited in the load-test plan.
