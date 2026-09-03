# 0014 — Source, clinical memory and inference are three layers, not one summary

**Status:** Accepted. Required by the Clinician Thoughts handoff's Phase 0
architecture gate, which asks for a feature ADR "recording source/memory/
inference boundaries" before any of it merges.
Consumes [ADR 0010](0010-event-sourced-longitudinal-spine.md) (event spine),
[ADR 0011](0011-tenancy-and-person-account-separation.md) (tenancy) and
[ADR 0012](0012-ai-gateway.md) (all model calls).

## Context

A clinician finishes a session and knows things about the patient that no field
in this product can hold: that they seemed steadier today, that the sister keeps
coming up, that the sleep thing might connect to the work thing, that they are
not sure the patient is ready. Today those either become formal note prose —
where they are unsearchable and undifferentiated — or they are lost.

The handoff's build directive is to let the clinician speak, transcribe it,
organize it into typed items, have the clinician approve them, and then use that
approved memory for threads, Session Prep and patient-scoped retrieval.

The tempting design is one AI-maintained patient summary that gets better as
more is said about the patient. The handoff forbids it in as many words: *"Do
not maintain one AI-written master patient summary. Build small, source-backed
objects and create views from them."*

That instruction is the whole architecture, and it is worth writing down why,
because a summary is genuinely easier to build and looks better in a demo.

**A summary cannot be interrogated.** §31 requires every material generated
claim to expose its source records. A paragraph that has absorbed forty
observations has no per-sentence provenance to expose, so "Why am I seeing
this?" has no answer.

**A summary cannot be reconstructed at a point in time.** Preparing for a
historical encounter, or answering an audit about what was known in March,
requires the state as of a cutoff. A summary rewritten on every update has one
state: now.

**A summary flattens epistemic status, and that is a clinical safety problem.**
This is the failure the handoff names most sharply. "I think this may connect to
abandonment" is not "abandonment is an active patient theme." "I am not sure she
is ready" is not "patient not ready." A model asked to keep a summary current
will do that flattening every time, because fluent prose has no natural place
for hedges, and the flattened version reads as more useful.

## Decision

### 1. Three layers, with different mutation rules

| Layer | Holds | How it changes |
|---|---|---|
| **Source** | Audio metadata, transcript versions, formal notes, check-ins, assessments | Append or supersede. Never silently overwritten |
| **Clinical memory** | Small approved structured items | A correction appends a replacement carrying `supersedes_id` |
| **Intelligence** | Patterns, candidate links, generated answers | Never becomes clinical fact without an explicit clinician action |

Views are built from the layers. The layers are not built from views.

### 2. Epistemic status is a column, not a phrasing

`clinical_memory_items.statement_class` is one of `clinician_observation`,
`patient_report`, `clinician_hypothesis`, `clinician_uncertainty`, and it is
`NOT NULL` with a `CHECK`. A hypothesis is a different kind of record from an
observation, not the same record worded more cautiously — so nothing downstream
can promote one by rephrasing, and the retrieval layer can exclude or label a
class rather than hoping a prompt remembers to.

The amendment (§27) extends the same rule across a source boundary: a patient's
statement to the AI Companion stays patient-reported evidence, and a
Companion-generated response is not clinical evidence about the patient merely
because the model produced it.

### 3. A model may propose; only a person may accept

Thread membership carries `proposed_by` and `decided_by` as separate columns,
and Phase 3's definition of done is "no auto-link in v1". Inferences live in
their own table with their own status, and reach clinical truth only through a
clinician's action. §31 states it as a rule — *no inference promotion* — and the
schema is what makes it one rather than a hope about prompt wording.

### 4. Everything durable goes through the event spine

Per ADR 0010 and §24: mutations append registered events, and no direct-only
write path is added. Thread decisions, approvals, corrections and supersessions
are all events, which is what lets a reviewer replay how a patient's memory came
to look the way it does.

### 5. Every model task is a gateway task

Per ADR 0012 and §9: extraction, thread matching, Session Prep composition,
patient-query answering and note drafting are registered tasks with versions,
schemas and evaluation sets. No feature in this layer calls a provider.

### 6. Audio defaults to deletion

§13 makes retention an org policy and requires deletion to be recorded rather
than claimed. It does not say what happens when an organization has not chosen,
and the default matters more than it looks: a recording of a clinician talking
about a patient is the most sensitive artifact this product would hold —
unstructured, containing whatever they happened to say, and reviewed by nobody.

So the default is `delete_after_verified_transcript`, in demo and production
alike. An organization that wants retention states so. The alternative default
means an organization acquires an audio archive of its clinicians by never
making a decision.

Demo uses the same default rather than a looser one: a demo whose retention
differs from production teaches a reviewer the wrong thing about the product
they are reviewing.

## Consequences

**Gains**

- Every displayed claim can name its sources, so "Why am I seeing this?" has an
  answer that is computed rather than composed.
- Point-in-time reconstruction is possible, so Session Prep for a historical
  encounter cannot leak information that arrived later (§31, no future-data
  leakage).
- A clinician's uncertainty survives being stored, retrieved, ranked and
  rendered.
- Tenancy is enforced by the same mechanisms as the rest of the product: every
  patient-bound table carries `tenant_id` and `person_id`, so the Postgres
  policy loop covers them without an edit.

**Costs**

- More tables and more joins than a summary field. Assembling a view is real
  work rather than a read.
- Extraction quality becomes a product surface: a clinician who has to correct
  most items will stop speaking, and that is a failure of this feature even when
  every safety property holds.
- Storage grows with talking rather than with sessions.

**Risks**

- *Approval fatigue.* If reviewing candidates is slow, clinicians will approve
  in bulk without reading, and an unread approval is worse than no approval
  because it carries a human's name. Mitigation: the review step's own
  acceptance criterion is that approve/edit/remove is "fast and atomic", and
  §23 tracks `item_edit_rate` and `rejection_rate` as quality signals precisely
  so this is visible rather than assumed.
- *The summary comes back by the side door.* A Session Prep section that
  generates freely, or an "Ask Steady" answer stored back as memory, recreates
  the flattening this ADR exists to prevent. Mitigation: §12 makes every answer
  read-only, and every generated claim must resolve to authorized evidence IDs
  or be withheld.
