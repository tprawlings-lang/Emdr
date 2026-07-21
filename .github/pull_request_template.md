## What & why

<!-- One or two sentences. Link any ADR or COMPLIANCE.md item this relates to. -->

## Type of change

- [ ] Feature
- [ ] Fix
- [ ] Refactor / chore
- [ ] Docs

## Safety & security checklist

<!-- Tick what applies; delete rows that genuinely don't. -->

- [ ] New user input is parameterized and clamped/whitelisted (no string-built SQL, no unescaped HTML)
- [ ] Server actions call `requireUser`/`requireMember`/`requireClinician` and scope queries to `user.id`
- [ ] New member free text goes through `encryptField` (`src/lib/crypto.ts`)
- [ ] Security-relevant events append a content-free coded entry to the audit chain
- [ ] No gate (screener hard stop, consent, subscription, unlock) was loosened without a linked decision
- [ ] Product copy adds no outcome/medical claims (banned-vocab grep passes)
- [ ] New/changed color pairs meet WCAG 2.2 AA; motion respects reduced-motion & photosensitivity

## Tests

- [ ] `npm run test:safety` passes
- [ ] `npm run build` passes
- [ ] Added/updated tests for safety-critical logic or a regression test for a fix

## Notes for the reviewer

<!-- Anything that needs a human decision, or context that isn't obvious from the diff. -->
