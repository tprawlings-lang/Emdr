# Incident Response Runbook (one page)

Compliance packet 6.3. Keep this current; it is referenced by the privacy
policy and (typically) required by cyber liability insurers.

> **This runbook is written for the wellness lane and remains the operative
> process today** — Steady holds no PHI and is nobody's Business Associate.
> Once the lane reclassification (ADR 0009) completes and real health data
> exists, the HIPAA obligations, Steady-specific incident scenarios, and role
> assignments in
> [`security/09-incident-and-breach-response-update.md`](security/09-incident-and-breach-response-update.md)
> apply **in addition** to what follows. That document's §1 decides which
> regime governs in one question.

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

## Real information found in a fabricated environment

The identity scan reads the fabricated population's own columns and reports a
value shaped like a real-world identifier — a deliverable email domain, a
government identifier, a telephone number, a street address. A finding means
somebody's real detail is sitting in a demonstration dataset that is reset,
exported, screen-shared and shown to reviewers.

**This is an incident, and the remedy is never the label.** The temptation is
specific and worth naming: the environment already carries a FABRICATED flag,
and the flag is about the ACCOUNT rather than about any particular value, so it
does not become true by being left on. Changing what a screen says about the
data does not change what is in it, and a dataset relabelled instead of cleaned
is one that leaves the building with the finding intact.

1. **Declare it.** Same trigger as everything above: suspicion is enough.
2. **Stop the export path before the cleanup.** Anything already generated may
   carry the value. `export_jobs` records every file, its filter and its
   content hash — use it to list what left, then supersede or expire those
   outputs. A cleaned database and a circulating CSV is a fix on one side only.
3. **Remove the value, not the row.** Keep the record so the demonstration
   stays coherent; replace the contaminated value with a generated one from the
   seed's own vocabulary. Deleting the person hides the finding from the scan
   without answering how it arrived.
4. **Find how it arrived.** A pasted note, an import, a real account whose
   provenance was never stated, a fixture copied from somewhere. Until that is
   answered the same value comes back on the next reset.
5. **Re-run the scan and let the gate speak.** `demo_identity` fails while the
   scan is anything but clean, so the release gate stays blocked; a clean
   re-run is the evidence, not an assertion that it was handled.
6. **Record it.** The scan is a point-in-time reading, and a clean one afterwards
   is indistinguishable from one that was never dirty. The finding, its shape
   (never its value), how it arrived and what was done go in the postmortem.

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
