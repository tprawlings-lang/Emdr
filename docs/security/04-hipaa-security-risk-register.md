# 4 — HIPAA Security Rule risk register

**Phase 2 security package**, item 4 of 10.

**What this is.** A structured assessment against the HIPAA Security Rule safeguards
(45 CFR §164.308, §164.310, §164.312, §164.316), recording for each: the current state, the
gap, and the acceptance test that closes it.

**What this is not.** This is **not** a HIPAA risk analysis in the regulatory sense
(§164.308(a)(1)(ii)(A)). That is a formal exercise conducted under counsel with a defined
methodology, and it has not been performed. Steady is **not HIPAA compliant**, is not a
Business Associate to anyone, and holds no PHI. This register is preparation for that
analysis, and its main function today is to make the size of the gap legible.

**Applicability.** These safeguards do not currently bind Steady — ADR 0009's lane
reclassification is Proposed and counsel has not been engaged. They are used here as the
design standard the platform is being built toward.

Legend: ✅ in place · ◐ partial · ❌ absent · **R** Required · **A** Addressable

---

## Administrative safeguards (§164.308)

| Ref | Safeguard | R/A | State | Current | Gap and acceptance test |
|---|---|---|---|---|---|
| 308(a)(1)(ii)(A) | Risk analysis | R | ❌ | This register only | Formal risk analysis under counsel. **Acceptance:** signed analysis on file (Founder + Counsel, Phase 2) |
| 308(a)(1)(ii)(B) | Risk management | R | ◐ | Findings tracked with owners and acceptance tests (item 3 Part C) | Formal remediation plan with dates. **Acceptance:** every High finding has a target date and owner |
| 308(a)(1)(ii)(C) | Sanction policy | R | ❌ | — | Written policy for workforce non-compliance (Founder, Phase 2) |
| 308(a)(1)(ii)(D) | Information system activity review | R | ◐ | Hash-chained audit log covering 8 event families; verifiable | **Nobody reviews it on a schedule.** A log with no reviewer is evidence, not a control. **Acceptance:** documented weekly review with a named owner (Security, Phase 2) |
| 308(a)(2) | Assigned security responsibility | R | ❌ | — | Name a Security Official. **Acceptance:** named in this document (Founder, **now** — this is free) |
| 308(a)(3) | Workforce security | R | ❌ | — | Authorization, clearance, and termination procedures (Founder, Phase 2) |
| 308(a)(4) | Information access management | R | ◐ | Role-based access in the application; tenant scoping built | **Clinicians see every member** (item 3, A3). Caseload scoping required. **Acceptance:** out-of-caseload request returns not-found and is audited (Engineering + Clinical, Phase 4) |
| 308(a)(5) | Security awareness and training | A | ❌ | — | Training for anyone touching the system (Founder, Phase 2) |
| 308(a)(6) | Security incident procedures | R | ◐ | [`../incident-response.md`](../incident-response.md) exists and is concrete | Written for the **wellness lane** (FTC HBNR). Needs HIPAA breach-notification rules and BA obligations — item 9 |
| 308(a)(7) | Contingency plan | R | ◐ | Scheduled encrypted backups with failure alerting; [`../disaster-recovery.md`](../disaster-recovery.md) | **Restore never rehearsed** (item 3, T4.2). **Acceptance:** ADR 0013 gate **G6** — restore + audit-chain verification pass (Ops, Phase 3) |
| 308(a)(8) | Evaluation | R | ◐ | CI gates: `@safety`, tenant-isolation/RLS attack suite, e2e + axe, `npm audit`, gitleaks, banned vocabulary | No **independent** security review. **Acceptance:** external reviewer report on file (Founder + Security, Phase 2) |
| 308(b)(1) | Business associate contracts | R | ❌ | **No BAAs with any vendor** | Item 5. **Acceptance:** executed BAAs with every vendor reaching PHI, before any real data |

## Physical safeguards (§164.310)

| Ref | Safeguard | R/A | State | Notes |
|---|---|---|---|---|
| 310(a) | Facility access controls | R | ◐ | Inherited from the hosting provider; **to be evidenced by BAA and their compliance report**, not by us |
| 310(b)(c) | Workstation use and security | R | ❌ | No policy for developer/operator workstations that hold credentials |
| 310(d) | Device and media disposal / re-use | R | ◐ | Cloud-only; provider-dependent. Backup deletion follows `BACKUP_RETENTION_DAYS` |

## Technical safeguards (§164.312)

| Ref | Safeguard | R/A | State | Current | Gap and acceptance test |
|---|---|---|---|---|---|
| 312(a)(1) | Access control — unique user ID | R | ✅ | Per-account identity; stateless HMAC sessions with idle + absolute expiry and `token_epoch` revocation | — |
| 312(a)(2)(ii) | Emergency access procedure | R | ◐ | `crossTenantContext()` is audited; kill switches exist | Break-glass procedure not documented. **Acceptance:** written procedure + rehearsal (Ops, Phase 2) |
| 312(a)(2)(iii) | Automatic logoff | A | ✅ | Idle expiry on the session cookie, 30-day absolute cap | — |
| 312(a)(2)(iv) | Encryption and decryption | A | ✅ | AES-256-GCM application-layer field encryption (ADR 0002) | Key custody is the weakness, not the algorithm — see 312(e) and item 3 T2.3 |
| 312(b) | Audit controls | R | ◐ | Hash-chained, append-only, verifiable; on Postgres the application role gets only SELECT/INSERT | **Database-level access is not audited** — an operator reading rows directly leaves no trail (item 3 T2.4). **Acceptance:** direct database reads appear in a log the application cannot alter (Ops, Phase 3) |
| 312(c) | Integrity | R | ✅ | Hash chain detects tampering; event log is append-only; corrections supersede rather than overwrite | — |
| 312(d) | Person or entity authentication | R | ◐ | Password + lockout | **No MFA for clinician or admin accounts.** For a clinical surface this is the notable gap. **Acceptance:** MFA required for every non-member role (Engineering, Phase 4) |
| 312(e)(1) | Transmission security | R | ◐ | TLS everywhere; HSTS with `includeSubDomains` | PHI crossing TB-3 is protected in transit but **retained by the provider without a BAA** (item 3 T3.1) |

## Organizational and documentation (§164.314, §164.316)

| Ref | Requirement | State | Notes |
|---|---|---|---|
| 314(a) | Business associate contracts | ❌ | Item 5 |
| 316(a) | Policies and procedures | ◐ | Engineering decisions well documented in ADRs; **organizational policies largely absent** |
| 316(b)(1) | Documentation retained 6 years | ❌ | No retention policy for security documentation |
| 316(b)(2)(ii) | Periodic review and update | ❌ | No review cadence for this package |

---

## Summary

| Category | ✅ | ◐ | ❌ |
|---|---|---|---|
| Administrative | 0 | 6 | 6 |
| Physical | 0 | 2 | 1 |
| Technical | 3 | 4 | 0 |
| Organizational | 0 | 1 | 3 |

**The shape of this is the finding.** Technical safeguards are the strongest category —
encryption, audit integrity, session control, and access control are genuinely built and
tested. Administrative and organizational safeguards are the weakest, and they are mostly
*documents and decisions rather than code*: a named Security Official, a sanction policy, a
training record, a review cadence, executed BAAs.

That asymmetry is typical of an engineering-led build and it is worth stating plainly to
reviewers, because it cuts both ways. The expensive, hard-to-retrofit half is largely done.
The cheap half is entirely undone, and it is the half a compliance reviewer checks first.

Several items cost nothing and are blocked only on a decision — naming a Security Official
(308(a)(2)) is a sentence, and protecting the `main` branch is a settings toggle.

---

## Top ten, in remediation order

1. Name a Security Official — §308(a)(2). *Free, blocked on a decision.*
2. Protect `main`, require PRs and green checks — supports §308(a)(1)(ii)(B). *Free.*
3. Execute BAAs with V1, V2, V3, V7 — §308(b)(1), §314(a). **Blocks any real data.**
4. Move keys to a secret manager with rotation — §312(a)(2)(iv), §312(e).
5. Rehearse backup restore — §308(a)(7). Gate **G6**.
6. Formal risk analysis under counsel — §308(a)(1)(ii)(A).
7. Caseload scoping for clinicians — §308(a)(4).
8. MFA for clinician and admin — §312(d).
9. Database-level access auditing — §312(b).
10. Independent security review — §308(a)(8).

Items 1, 2, and 5 could be closed this week. Item 3 is the one that gates everything else.
