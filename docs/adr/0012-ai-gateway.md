# 0012 — All model calls route through a Steady AI Gateway

**Status:** Accepted and implemented (core). The gateway is `src/lib/ai-gateway/`,
every model call in the product routes through `invoke()`, and a guard fails the
build if any module outside `src/lib/ai-gateway/provider.ts` imports a provider
SDK. Built as the Phase 0 architecture gate of the Clinician Thoughts handoff,
whose first definition of done is "no code path can accidentally call a model
provider directly."

Landed: the single entry point (§1), the task registry (§2), tool tiers with the
prohibited tier enforced at registration (§4), provenance on every inference
(§6), and a swappable provider so evaluation can run against fixtures (§7).

Not yet landed: generic structured-output validation (§3) — it stays per-task;
the deterministic crisis check still runs at the companion call site rather than
inside the gateway (§5); and §7's golden sets exist only as the fixture provider
the tests use.

**Migration note.** This ADR counted four direct call sites. There were five: a
health-check API route reached the provider too — a file nobody thinks of as AI
code, which is exactly the erosion §1 predicts. And two of the four were
character-for-character identical copies of the same rephrase call in the web and
mobile paths; they are now one registered task.

A fifth tool tier was needed. `escalate_risk` notifies a care team and fits none
of §4's four: it is not patient-owned or reversible, and `write-clinical`'s
"requires human confirmation" is wrong for a suicide-risk alert, because waiting
is the harm. `safety-escalation` is admissible only for an action that can raise
protection and never lower it.
Consumes [ADR 0010](0010-event-sourced-longitudinal-spine.md) (provenance) and
[ADR 0011](0011-tenancy-and-person-account-separation.md) (purpose-scoped retrieval).

## Context

Four call sites reach the model provider directly:

| Call site | Model | What it does |
|---|---|---|
| `companion-ai.ts:484` | `claude-opus-4-8` | Companion replies, with a tool set (`record_trigger`, `remember`, `escalate_risk`) |
| `program-plan.ts:183` | `claude-opus-4-8` | Drafts the program plan under a JSON contract |
| `mobile/voice.ts:94` | `claude-haiku-4-5` | In-session spoken responder |
| `actions.ts:1465` | `claude-haiku-4-5` | Short generative helper |

Each independently constructs its prompt, handles its own failure, and picks its own
model. Handoff A7 requires the opposite:

> All model calls pass through a Steady AI Gateway. **No feature calls a model provider
> directly.** Gateway owns model routing, structured outputs, tool permissions,
> prompt/version registry, PHI policy, cost, latency, retries, fallback, evaluation, and
> provenance.

What exists today is genuinely good and should be preserved: deterministic crisis
detection runs *before* every model call, the output guard blocks a documented never-say
list, tools already use `input_schema`, and every path falls back to the rules engine.
The problem is that these are enforced **per call site by convention**. A fifth call site
added by someone who has not read the safety rules inherits none of it.

Two downstream requirements make the gateway a hard dependency, not a refactor:

- **B5** requires versioning "every model, prompt, intervention, feature, and scoring
  policy," with golden sets and regression suites. Impossible when prompts are string
  literals in four files.
- **D5 Learning Ledger** must answer: *what did Steady think, why, what happened, was it
  right?* — which requires model version, prompt version, and evidence IDs recorded at
  the moment of inference.

The vendor-independence clause in every handoff's downstream contract ("independent of any
single foundation-model vendor") also cannot be satisfied by four hardcoded call sites.

## Decision

### 1. One entry point

```ts
gateway.invoke({
  task,            // registered task id — 'companion.reply', 'plan.draft', …
  tenantId, personId,
  purpose,         // drives memory retrieval scope (ADR 0011 §5)
  input,           // typed
  context,         // requested memory classes — the gateway resolves them
}): Promise<GatewayResult<T>>
```

Feature code never sees a provider SDK. A lint rule forbids importing one outside
`src/lib/ai-gateway/`, so the invariant is enforced mechanically rather than by review.

### 2. Task registry — the unit of versioning

Each task is a registered, versioned record: prompt template + version, output schema,
allowed tools with risk tiers, model policy, retrieval scope, fallback behaviour, and
evaluation set. Prompts stop being string literals and become versioned artifacts, which
is what B5 requires and what makes a regression detectable.

### 3. Structured output is validated, not trusted

Every task declares a JSON schema. Invalid output is rejected and retried; persistent
failure falls back deterministically. This generalizes what `program-plan.ts` already
does ad hoc — and enforces Master §6's principle:

> The generated sentence is disposable. The structured evidence and provenance are
> permanent.

Concretely: the gateway returns typed objects. Prose is a rendering of the object, never
the object itself.

### 4. Tools are allowlisted per task, with risk tiers

| Tier | Meaning | Example |
|---|---|---|
| `read` | Retrieval only | fetch a memory class |
| `write-soft` | Patient-owned, reversible | `remember`, `record_trigger` |
| `write-clinical` | Enters the clinical record | requires human confirmation |
| `prohibited` | Never model-invokable | clear a crisis state, unlock a gated pathway, change permissions, erase history, diagnose |

The prohibited tier makes A6's boundary structural: *"Generative output cannot override a
safety state."* Today that holds because no such tool is defined. Under the gateway it
holds because the tier rejects it.

### 5. Safety ordering is enforced by the gateway

Deterministic crisis detection and the output guard move **inside** the gateway, in front
of and behind every call. Per ADR 0009 this is safety-floor behaviour: enforced in every
environment tier including demos, and not bypassable by any un-gate flag.

### 6. Provenance on every inference

Each call emits an `AIInference` record and a `LongitudinalEvent`: task and version, model
and version, prompt version, structured output, evidence IDs, latency, token cost,
output hash, tenant, purpose. This is the substrate for B4 clinician feedback labels and
D5's ledger — and it is why the gateway must land before the features that will need to
be evaluated later.

### 7. Evaluation is a first-class surface

Golden sets per task, safety regression cases, grounding checks, and drift monitoring —
runnable in CI against recorded fixtures without live provider calls. The existing
red-team harnesses fold in here as the seed corpus.

### 8. Migration path

1. Build the gateway with one task: `plan.draft` — lowest risk, already schema-shaped.
2. Migrate `voice.ts` and the `actions.ts` helper.
3. Migrate `companion.reply` last: highest risk, most tools, most safety surface. Run
   both paths against the golden set and diff before cutting over.
4. Add the lint rule forbidding direct provider imports.

## Consequences

**Gains**

- Safety guarantees become structural. A new feature cannot accidentally skip crisis
  detection or the output guard, because it cannot reach a model without passing through
  them.
- B5 evaluation and D5's Learning Ledger become buildable.
- Vendor independence becomes real: model policy is one registry field.
- Cost and latency become observable per task and per tenant — needed for the "$18 per
  active user per month" line in the economic model to be measured rather than assumed.
- A security reviewer gets one auditable boundary for PHI-to-model flow instead of four.

**Costs**

- Indirection: a debugging step moves from "read the function" to "read the task record."
- The task registry is a new artifact needing its own review discipline.
- Migrating `companion.reply` is delicate — it carries the most safety behaviour and the
  best-tested existing code.

**Risks**

- *Gateway as bottleneck.* If it becomes a place every feature must negotiate with, teams
  route around it. Mitigation: adding a task must be genuinely easy — a registry entry,
  not a code review of the gateway itself.
- *Regression during companion migration.* Mitigation: dual-run against golden sets and
  diff outputs before cutover; the existing red-team suites must stay green throughout.
