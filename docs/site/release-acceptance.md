# Institutional site — release acceptance

**Mandated by** the Institutional Website Redesign Handoff §17.
**Run:** 2026-08-27 · **Branch:** `claude/launch-status-vh6vbo`

This records what was tested, with the exact command, and — as importantly — what was
**not** tested. The handoff's own rule applies to this document as much as to the site:

> "Do not quote a test count, security control, clinical review, or branch state to
> investors or reviewers unless it can be tied to the exact demonstration commit."

So every number below is reproducible from this repository at the commit this document
is committed in. A result copied forward to a later build is not a result.

---

## 1. Automated gates

| Gate | Command | Result |
|---|---|---|
| Safety and unit suite | `npm run test:safety` | **410 tests, 410 pass, 0 fail** |
| End-to-end suite | `npm run test:e2e` | **77 tests, 77 pass, 0 fail** |
| Tenant isolation (real Postgres) | `npm run test:rls` | **PASS** — 12 cross-tenant attack cases |
| Production build | `npm run build` | **Compiled successfully** |
| Typecheck | `npx tsc --noEmit` | **Clean** |

The e2e count includes 40 cases in `tests/e2e/institutional-site.spec.ts` and 17
accessibility audits in `tests/e2e/a11y.spec.ts`.

## 2. Claims scan (§15)

`tests/public-copy-guard.test.ts` — **27 cases, all passing**. It scans source rather than a
rendered page, so a violation fails in the commit that introduces it rather than after a
deploy. It covers 19 public routes and 5 content modules, and enforces:

- No link to a retired retail route (`/signup`, `/subscribe`) from any public page.
- No pricing, free-trial, or enrollment language that is not stated as a denial.
- Restricted phrases ("HIPAA compliant", "clinically validated", "24/7 monitoring",
  "production ready", and five others) only inside an explicit denial or requirement.
- Every capability status drawn from the registry, with an owner, a review date, and an
  audience list.
- Every FAQ answer leading with a verdict; consequential answers carrying a review date and
  an owner; no boundary question answered "Yes".
- Every control carrying a state, an owner, and — if claimed as current — evidence.
- Every gap carrying an owner, an acceptance condition, and the tier it must close before.
- The demo gateway printing no access code and no persona password.
- The demo legal documents stating that counsel has not reviewed them.

**Verified adversarially.** The guard was confirmed to fail by temporarily inserting
`"Steady is HIPAA compliant and clinically validated. Start your free trial for $29/month."`
into `/about`; two cases failed with the offending phrases named, and the edit was reverted.
A guard that has never been seen to fail is a guard nobody has tested.

## 3. Route and link testing (§17)

All 15 public routes return 200 with exactly one `h1`. All 14 institutional pages carry the
shared header and footer navigation. `/crisis` deliberately carries **no** site chrome —
no navigation, no marketing, no unrelated links — and is asserted for reachability and for
naming 988, never for chrome.

Every internal `href` in the header and footer is fetched and asserted under 400, so a
broken navigation link fails the build. This is the check that caught `/about` being linked
before it existed.

## 4. Access-flow testing (§12)

The four-step sequence is walked end to end:

1. **Closed by default.** With `EMDR_REVIEW_ACCESS_CODE` unset the gateway shows "Access is
   closed" and offers no form. A missing configuration never means open.
2. **Wrong code refused.** Redirects with a generic failure that does not distinguish a bad
   code from a bad path, and the correct code never appears in the response body.
3. **Scope enforced server-side.** A read-only path is offered no write-capable persona, and
   posting a clinician email against a read-only path is refused and audited rather than
   honoured.
4. **The grant, not the URL, decides.** Holding an investor grant and navigating directly to
   `/demo/clinical` redirects to the gateway.
5. **Keyboard-only.** The whole gateway — path radio, code field, submit — is operable
   without a mouse.

Each attempt writes an audit record: `review_access_denied`, `review_access_granted`,
`review_persona_refused`, `review_persona_entered`.

## 5. Accessibility (§17)

`tests/e2e/a11y.spec.ts` audits **all 17 public pages** with axe-core against WCAG 2.0/2.1
A and AA. **Zero serious or critical violations.** Moderate and minor findings are attached
to the run for triage rather than dropped.

Narrow-viewport rendering is asserted at 375 px on `/`, `/trust`, `/faq`, and `/demo`: no
page scrolls horizontally, and wide content (the status tables) scrolls inside its own
container.

**Not automated:** a real screen-reader pass (VoiceOver / NVDA), tested colour-contrast
judgement beyond what axe computes, and reflow at 200% zoom. Automated auditing catches
roughly the violations a machine can see; it is not a substitute for someone using the
site with a screen reader. This is listed as an open item, not as a passed check.

## 6. Data scan (§3)

The environment is scanned for real-person data before any reviewer session:

```
npm run demo -- health     # schema, seed, spine, tenancy, encryption
npm run demo -- baseline   # time-invariant hash of the projected state
```

Accounts present after a reset are `demo@example.com`, `demo2@example.com`, and
`clinician@example.com` — all RFC 2606 reserved, so none can route to a real inbox.

**Standing condition, not a one-time check.** The deployed instance accumulates state from
its own use: a failed sign-in records the attempted address verbatim in the audit log, and
`/signup` created real accounts while it was open. Enrollment must be closed *before* a
reset, or the reset simply re-contaminates. Any real-person information found in a
T0/T1 environment is a stop condition — isolate, preserve evidence, notify the named owner,
assess exposure, remove through the approved process, and do not resume until the cause is
corrected.

**Outstanding founder action:** run `npm run demo -- reset` against the deployed Render
instance now that enrollment is closed. Until that is done, this section is verified for
the local build only.

## 7. Indexing

`src/app/robots.ts` disallows all crawling globally, asserted by the copy guard. The
review environment is not a public site and must not be discoverable.

## 8. Open items

| Item | Owner | Blocks |
|---|---|---|
| Screen-reader pass on the institutional pages | Founder | Accessibility statement accuracy |
| Counsel review of the Demo Terms and Demo Privacy Notice | Counsel | Removing the "unreviewed" marking |
| `npm run demo -- reset` against the deployed instance | Founder | Sharing the environment externally |
| Host separation (marketing vs. review environment) | Founder | Deferred by decision — Render only for now |

None of these blocks the site itself. All four are stated on the pages they affect rather
than held privately.
