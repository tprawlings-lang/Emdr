# Incident Response Runbook (one page)

Compliance packet 6.3. Keep this current; it is referenced by the privacy
policy and (typically) required by cyber liability insurers.

## Who declares an incident
The founder (or the on-call engineer if unreachable for 1 hour) declares an
incident the moment unauthorized access, data exposure, or a safety defect is
*suspected* — certainty is not required to start the clock.

## First three steps, in order
1. **Revoke and rotate keys.** Render dashboard → Environment: rotate
   `EMDR_SESSION_SECRET` (invalidates all sessions), `ANTHROPIC_API_KEY`, and
   `EMDR_DATA_KEY` only if key compromise is suspected (rotating it makes
   previously encrypted rows unreadable — snapshot first). Set
   `EMDR_DISABLE_NEW_SESSIONS=1` if the defect is safety-related.
2. **Snapshot evidence.** Copy the persistent disk (Render disk snapshot),
   export recent application logs, and save the audit_log table. Do this
   before any fix that could overwrite state.
3. **Assess scope.** Which tables/fields were reachable? Was member free text
   exposed (it is AES-256-GCM encrypted at the application layer — exposure
   of ciphertext alone is a lower-severity event than key + data)? How many
   accounts? Over what window?

## User-notification decision tree (FTC Health Breach Notification Rule)
The HBNR applies to consumer health/wellness apps — non-HIPAA status does not
exempt us.

- Unsecured identifiable health data acquired by an unauthorized party?
  - **No** → document the assessment and the basis for "no"; fix; postmortem.
  - **Yes, < 500 individuals** → notify affected users and the FTC within 60
    calendar days of discovery.
  - **Yes, ≥ 500 individuals** → notify affected users, the FTC, and
    prominent media within 60 days — and engage counsel before any notice
    goes out.
- Check state law overlays in parallel: WA My Health My Data, NV, CT have
  their own consumer-health-data triggers and shorter practical timelines.

## Contacts
- Counsel: retained (reviewed ToS/Privacy 2026-06-10) — [insert current contact details]
- Cyber liability insurer / breach hotline: [insert after policy bound — see
  packet 6.3 ACTION]
- Render support: https://render.com/support
- Anthropic security: security@anthropic.com

## After
Postmortem within 5 business days: timeline, root cause, what detection
missed, fixes merged (link PRs), and whether the @safety suite or ZAP
baseline needs a new case.
