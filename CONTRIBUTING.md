# Contributing & code-review standards

Steady is a health-adjacent product in the **wellness lane** (see
[`COMPLIANCE.md`](COMPLIANCE.md)). Review discipline is a safety control, not a
formality.

## Branching & PRs

- Branch off the current working branch; open a PR — no direct pushes to a
  release branch.
- Every PR must pass the `safety` CI workflow (`.github/workflows/safety.yml`):
  the `@safety` test suite, the production build (type-check), `npm audit`
  (high/critical block), and the banned-vocabulary grep.
- Keep PRs focused. A PR that touches safety gating, auth, crypto, or the audit
  chain should touch little else.

## What every reviewer checks

**Correctness & safety**
- Does any new user input reach a query? It must be parameterized and
  clamped/whitelisted — no string-built SQL, no unescaped HTML.
- Does the change touch a **gate** (screener hard stops, consent, subscription,
  module unlock)? Gates may only be added, never loosened, without a linked
  decision. Confirm the block reason is shown to the member with a resolve path.
- New member free text? It must go through `encryptField` (`src/lib/crypto.ts`).
- New security-relevant event? It must append a **content-free coded** entry to
  the audit chain (`src/lib/audit.ts`) — never raw member text.

**Authorization**
- Every server action starts with `requireUser`/`requireMember`/
  `requireClinician` and scopes queries to `user.id`.
- Clinician access to a member record writes an audit entry.

**Product copy** (compliance 3.1)
- No outcome/medical claims ("cure", "treats PTSD", "AI therapist",
  "clinically proven"). The CI grep enforces this; don't work around it.

**Tests**
- Safety-critical logic (screener, SUDS, routing, crisis regex, rate limit,
  env-guard) needs a test in `tests/`. Bug fixes get a regression test.

**Accessibility**
- Interactive elements are keyboard-reachable and labelled; new color pairs
  meet WCAG 2.2 AA contrast (4.5:1 text). Respect `prefers-reduced-motion` and
  photosensitivity settings for any motion/bilateral stimulation.

## Local checks before pushing

```bash
npm run lint
npm run test:safety
npm run build
npm audit --omit=dev --audit-level=high
```

## Decisions

Architecturally significant choices are recorded as ADRs in
[`docs/adr/`](docs/adr/). If your change contradicts an accepted ADR, add a new
ADR that supersedes it rather than silently diverging.
