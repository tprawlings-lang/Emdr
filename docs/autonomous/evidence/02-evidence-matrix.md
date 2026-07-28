# Evidence matrix

**Config:** `beta-clinrev-2026-07` · Ledger §E gate 2.

Maps every safety parameter and rule to its source, its evidence basis, and its
clinician verdict at sign-off. Evidence basis is deliberately honest:

- **Corpus** — specified in the clinician-authored five-volume corpus.
- **Clinician-confirmed** — ratified in the 2026-07-22 sign-off (all rules Agree,
  all Section-A items Confirm).
- **Conservative default** — a safe value chosen where the corpus conflicted or
  was silent; flagged for pilot validation.
- **Absent / pending** — no external empirical evidence yet; relies on
  conservative design + human review. These are the honest gaps.

All numeric thresholds live in `src/lib/safety/config.ts` and are versioned in
the governance snapshot (`safetyConfigSnapshot()`).

## A. Numeric parameters (config.ts)

| Parameter | Value | Source | Evidence basis | Verdict |
|---|---|---|---|---|
| Autonomous stimulation/BLS | **disabled** | Clinical-review revision | Conservative (removes capability) | Confirmed (A3/A5/A7) |
| Visual BLS | disabled | Corpus + a11y | Conservative | Confirmed |
| DES-II surfaced | disabled | Ledger A9 | Absent (licensing/validation) → omitted | Confirmed |
| Starting-SUDS ceiling | 5 | Corpus §12 | Conservative default | Confirmed (fail-safe) |
| Max sets | 2 | Corpus/beta | Conservative; upper bound only | Confirmed |
| Wind-down / hard-stop | 30 / 40 min | Corpus (shorter of conflict) | Conservative; bound only | Confirmed (A3) |
| Closure minimum | 120 s (floor) | Corpus §12 | Floor, not sufficient | Confirmed (A2) |
| Containment delta / absolute / hard-stop | +2 / ≥8 / ≥9 | Corpus union | Conservative union | Confirmed (A2, fail-safe) |
| Rise-over-start | +3 | Corpus App A | Conservative union | Confirmed |
| Dissociation stop (in-session) | ≥4 | Corpus §5 | Conservative | Confirmed |
| Containment-ending cooldown | 48 h | Corpus (longer of conflict) | Conservative; interval pending | Confirmed w/ note (A4) |
| PHQ-9 item 9 flag | ≥1 (any) | Corpus §1 | Clinician-confirmed | Confirmed (clarification, no fixed lockout) |
| PCL-5 item 16 | ≥3 → context only | Clinical-review | Corrected (not a suicide proxy) | Confirmed |
| Daily dissociation | ≥7 / 4–6 | Corpus §3 | Conservative; anchors pending | Confirmed (review triggers) |
| Daily activation / shutdown | ≥8 | Corpus §3 | Conservative; scale pending | Confirmed |
| Sleep low | ≤2 | Corpus §3 | Conservative | Confirmed (cautious) |
| Weekly worsening (PCL-5 / ITQ) | ≥10 / ≥8 | Corpus §1 | Review trigger, not lockout | Confirmed |
| Acute-trauma exclusion | 30 d | Corpus A-8 | Conservative; review trigger | Confirmed |
| Readiness caps (Educational Access State) | ceiling 30 / 60 | Corpus §4 | Domain gates, not a score | Confirmed (A1) |
| Program-fit gate wording | `fit-v2-clinrev` | Clinical-review | Clinician-confirmed final | Confirmed (A8) |

## B. Rule-level ratification

All 63 deterministic rules (access/gating 29, session/BLS 18, voice/live 9,
therapy-KB 7) were marked **Agree** with zero Needs-change; all five §3.5
human-in-the-loop checkpoints confirmed. The rule inventory and per-rule
descriptions are in the signed form and the
[implementation spec](01-clinical-implementation-spec.md).

## C. Honest evidence gaps (design-mitigated, pending empirical validation)

These parameters rely on conservative design + human review, **not** on external
empirical evidence, and are the explicit subjects of the staged-validation
protocol:

1. Exact numeric anchors for the self-rated daily scales (dissociation,
   activation, shutdown, sleep) — currently conservative; the revision routes
   them to grounding + human review rather than treating the number as a
   diagnosis.
2. The containment-ending rest interval (48 h placeholder; A4).
3. Any BLS protocol parameters — **out of scope in beta** (disabled); require a
   separately validated protocol before they exist.
4. DES-II scoring/interpretation — omitted until licensed and validated.

## D. Cross-references
- Source of truth for values: `src/lib/safety/config.ts`,
  `safetyConfigSnapshot()`.
- Clinical ratification: [`../clinician-signoff-SIGNED-2026-07-22.pdf`](../clinician-signoff-SIGNED-2026-07-22.pdf).
- Behavior proof: [technical verification](03-technical-verification.md).
