# Handoff 10: Non-BLS Modules, Skills, Programs and Listening Content

**Repo:** `tprawlings-lang/Emdr`
**Place at:** `docs/handoffs/10-non-bls-modules.md` (content pack alongside as `docs/handoffs/10-content-pack.md`)
**Governs:** new member-facing content types, the Programs model, the clinician-assigned lane containers
**Does not change:** any safety authority, clinical threshold, tenancy boundary, release gate, BLS configuration, or Handoff 09 navigation decisions
**Companion files:** `10-content-pack.md` (all member-facing copy), `10-clinician-signoff.docx` (review worksheet)

---

## 0. Read this first

### 0.1 What this handoff does
Gives Steady a product spine that does not depend on EMDRIA sign-off. Today an autonomous member reaches 6 of 11 session modules, all EMDR stabilization. This handoff adds:

| Phase | What | Clinical gate |
|---|---|---|
| **P0** | Fix a BLS-shaped technique already live in the companion KB | None to build. Clinician confirms the rewrite |
| **1** | Skills library, Behavioral Activation program, Sleep program, 8 lessons, produced audio and soundscapes | Content ships per row as sign-off lands |
| **2** | Feeling and Relating program (complex-trauma skills), member thought records, Riding Strong Feelings program | Every item requires sign-off before it is visible outside demo |
| **3** | Clinician-assigned lane containers: WET, CPT worksheets, imagery rehearsal for nightmares | Parked behind Handoff 03's activation gate, a provider partner, and licensed protocol content |

### 0.2 The rule that governs everything here
**Unsigned content does not ship.** Every new content item carries a `signoffRowId`. `isContentLive()` returns false unless that row is `approved` in `autonomous_signoffs`. In demo mode drafts may render with a "Pending clinical review" chip; in any other environment they are absent from every list, route, API response, and companion selection. Fail closed, same principle as the null BLS constants.

### 0.3 Critical path
Only **P0, 1A and 1B** are on the critical path. They give the evolvedMD / CoCM conversation a depression and anxiety story measured on PHQ-9 and GAD-7 without waiting on EMDRIA. Everything else is sequenced behind them.

---

## 1. P0: `somatic-butterfly-hug` is self-administered BLS

**Finding.** `src/lib/therapy-kb/catalog.ts` entry `somatic-butterfly-hug` instructs the companion to offer "slow alternating taps" with arms crossed. That is the Butterfly Hug as taught in EMDR practice: self-administered bilateral stimulation. It is available at `AccessTier.GROUNDING_ONLY` with `maxActivation: 8`, which means the companion can offer it to highly activated members. This contradicts the v1 design constraint that BLS parameters are null and fail closed. The `avoidWhen` note ("do not pair with recalling distressing material") is advisory only per the KB's own honesty row `KB_AVOIDWHEN_ADVISORY`.

**Fix (ship now, confirm with clinician after):**
1. Rewrite the entry as a **static** self-hold. New id `somatic-self-hold`, name "Self-hold", guidance: hands resting on opposite upper arms or one hand on the chest and one on the belly, steady gentle pressure, no tapping, no alternation, no rhythm. Keep tier and ceiling.
2. Delete `somatic-butterfly-hug`. Do not keep it behind a flag; it belongs to the future BLS flag-flip review, not the KB.
3. Add `tests/kb-no-bls-shape.test.ts`: fails if any KB `guidance`, any practice `segments[].text`, or any content-pack derived string matches `/alternat(e|ing)\s+(tap|squeeze|touch|side)|left[\s,-]+(and\s+)?right|side[\s-]to[\s-]side|bilateral|butterfly/i`. Allow list only `src/components/BlsStimulus.tsx`, `src/lib/safety/**`, and `docs/**`.
4. Add to `/review/status` as a resolved finding with the date.

---

## 2. Standing constraints (all phases)

1. **No BLS shape anywhere outside the BLS system.** No stereo panning, no alternating haptics, no left/right visuals, no binaural or isochronic tones, no rhythmic audio in the 0.5 to 2 Hz range. Guarded by the P0 test plus the audio guard in section 8.
2. **Member boundary holds.** No scores, bands, streaks, counts, or trend charts on any new member surface. Ratings members enter (mastery, pleasure, distress, sleep quality) are stored and may appear only on `/app/progress` under its existing exemption and `assertPatternOnly`. New routes are added to `MEMBER_ROUTES` in `tests/member-boundary.test.ts`, never exempted.
3. **All member free text runs the crisis pre-filter before persistence.** Same deterministic regex as the companion. A match routes to the scripted crisis interrupt (`crisis-script-v1`) and nothing else happens. Then `enc1:` AES-256-GCM encryption. Member can view, edit, delete.
4. **Deterministic gating.** Every new item declares `minTier`, `maxActivation`, `imagery`. Gating is enforced in the listing function, not in the UI. Unknown state is treated as the most restrictive, matching `KB_UNKNOWN_STATE_CONSERVATIVE`.
5. **Companion is read-only against programs.** It may suggest; it may not enroll, complete, or write program state. This also closes part of the open audit finding "companion tools holding write access to session state" for the new surfaces.
6. **Wellness-lane copy.** No diagnosis, cure, or treatment claims. Modality names (DBT, ACT, STAIR, CBT-I) never appear in member copy; use "-informed" only in clinician and review surfaces.
7. **Phase 3 content is never self-startable.** No route, API, or companion path lets a member start clinician-assigned content without an active assignment.

---

## 3. Architecture

### 3.1 Extend `Practice` with a `skill` type (1A)

File: `src/lib/practices.ts`

```ts
export type PracticeType =
  | "breathwork" | "meditation" | "movement" | "sleep" | "soundscape" | "skill";

export interface SkillStep {
  /** Member-facing instruction. Plain language, one action. */
  text: string;
  /** Optional: seconds to hold on this step before "Continue" enables. */
  minSeconds?: number;
}

export interface Practice {
  // ...existing fields...
  /** Skill: ordered steps. Absent for other types. */
  steps?: SkillStep[];
  /** One line: when this is useful. Member-facing. */
  whenToUse?: string;
  /** Member-facing "skip this if" notes. Shown, not enforced. */
  skipIf?: string[];
  /** Gating. Required for type "skill" and for all new content. */
  minTier?: AccessTier;
  maxActivation?: number;
  imagery?: boolean;
  /** Traceability back to the KB entry the skill renders. */
  sourceTechniqueId?: string;
  /** Sign-off row that must be approved for this to be live. */
  signoffRowId?: string;
  /** Produced audio asset id, if recorded (1E). TTS remains the fallback. */
  audioAssetId?: string;
}
```

`listPractices()` changes from sort-only to **filter then sort**:

```ts
const engine = await evaluateAccess(userId);          // existing access engine
if (!engine) return [];                                 // cannot evaluate: nothing new
return items
  .filter((p) => isContentLive(p))
  .filter((p) => p.minTier === undefined || engine.tier >= p.minTier)
  .filter((p) => p.maxActivation === undefined || (engine.activation ?? 10) <= p.maxActivation)
  .filter((p) => !p.imagery || engine.capabilities.imagery)
  .sort(existingSort);
```

Existing 20 practices keep working: undefined gating fields mean "unchanged behavior." Do not backfill gating onto existing practices in this handoff; that is a separate clinical review.

`getPractice(id)` must apply the same gate when called from a member route. A deep link to a gated skill returns the "not available today" state from Handoff 09's interruption states, not a 404.

### 3.2 Programs (1B, 1C, 2A, 2C)

New file: `src/lib/programs.ts`. A Program is a short, self-paced sequence of units. Each unit bundles a lesson, practices, and at most one structured activity.

```ts
export type ProgramId =
  | "moving-toward"        // 1B Behavioral activation
  | "steadier-sleep"       // 1C Sleep
  | "feeling-and-relating" // 2A Complex-trauma skills (STAIR-informed)
  | "riding-strong-feelings"; // 2C DBT-informed sequence

export type ActivityKind =
  | "values-pick" | "activity-plan" | "activity-reflect"   // BA
  | "sleep-window" | "wind-down-plan" | "sleep-reflect"    // Sleep
  | "thought-record"                                      // 2B
  | "none";

export interface ProgramUnit {
  id: string;
  title: string;
  /** Member-facing: what this unit is for, one sentence. */
  purpose: string;
  lessonId?: string;
  practiceIds: string[];
  activity: ActivityKind;
  minTier: AccessTier;
  maxActivation: number;
  signoffRowId: string;
}

export interface Program {
  id: ProgramId;
  title: string;
  blurb: string;
  phase: 1 | 2;
  units: ProgramUnit[];
  /** Screens that must pass before enrollment (e.g. sleep safety questions). */
  entryScreenId?: string;
  outcomeMeasureIds: string[];   // e.g. ["phq-9"]; never shown to member here
  signoffRowId: string;          // program-level row
}
```

**Behavior**
- Self-paced. Unit N+1 unlocks when unit N is completed. No calendar pacing, no "you're behind," no overdue badges.
- Each unit re-checks gating on open. If today's tier or activation falls below the unit's floor, show the Handoff 09 "not today" interruption state and offer the grounding practices that are available.
- A member can hold multiple programs. Enrollment and leaving are both one tap and reversible.
- Returning after any gap shows "Pick up where you left off" with no reference to elapsed time.

**Tables** (add migrations under the current migration convention, tenant-scoped per ADR 0011):
- `program_enrollments (id, tenant_id, user_id, program_id, status[active|left|finished], created_at, updated_at)`
- `program_unit_completions (id, tenant_id, user_id, program_id, unit_id, created_at)`
- `activity_entries (id, tenant_id, user_id, program_id, unit_id, kind, payload_enc, created_at, updated_at, deleted_at)`: `payload_enc` is `enc1:` JSON. Ratings live inside the encrypted payload plus a coded, content-free copy in the spine event for clinician-side analytics.

**Spine events** (dual-write per ADR 0010): `program_enrolled`, `program_left`, `program_unit_completed`, `activity_entry_recorded` (kind and coded ratings only, never text).

### 3.3 Content liveness and sign-off

New file: `src/lib/content-signoff.ts`

```ts
export const CONTENT_V10_RULES: CatalogRule[] = [ /* one row per sign-off item, section 9 */ ];
export function isContentLive(item: { signoffRowId?: string }): boolean
```

- Rows use category `content_v10` in the same `autonomous_signoffs` storage and the same `/review` sign-off flow as the safety rules and `THERAPY_KB_RULES`.
- Row ids match the worksheet row numbers exactly (`CV10_A01` ... ) so a signed Word worksheet can be entered 1:1.
- Items without `signoffRowId` (existing content) are live as today.
- `/review/status` lists every `content_v10` row with state and what is withheld.

### 3.4 Free-text pipeline

Applies to: BA activity notes, sleep reflections, thought records, any "anything else?" field.

```
member text -> crisisPrefilter(text)            // existing deterministic regex
            -> match? scripted crisis interrupt, persist nothing, log coded safety event
            -> encrypt enc1: -> persist -> spine event (coded only)
```

- Text is **never** passed to the companion model and never included in the companion system prompt. The companion receives only coded facts ("completed unit 2 of moving-toward").
- Text is never shown on clinician surfaces in this handoff. Clinician visibility of member-authored entries is a Phase 3 decision tied to an assignment and consent.

### 3.5 Companion integration

- New companion tool `suggest_practice({ practiceId })`. Read-only. Returns a card the member can tap. Validates the id through the same gated `listPractices()` so the companion cannot surface a skill the member cannot open.
- `therapy-kb/select.ts` gains a pointer: when a selected technique has a member-facing skill (`sourceTechniqueId` match) and it is live, the guidance may end with a suggestion to open that skill.
- The companion has no tool that writes to `program_*` or `activity_entries`. Add a test asserting the companion tool list contains no writer for these tables.

### 3.6 Measures

- BA program: PHQ-9 on the existing cadence. No new instrument.
- Sleep program: add a sleep disturbance measure **only after licensing is confirmed** (founder action F1). Candidate: PROMIS Sleep Disturbance 8a. Until then the program runs with PHQ-9 and GAD-7 only and a non-scored member reflection.
- Measures are never displayed inside program screens. Scores reach members only on `/app/progress` under its existing rules.

### 3.7 Routes

| Route | Audience | Job |
|---|---|---|
| `/app/activities/skills` | member | Skills library, filtered by gate |
| `/app/activities/skills/[skillId]` | member | Skill player (step through) |
| `/app/activities/listen` | member | Soundscapes and recorded audio |
| `/app/programs` | member | Available and active programs |
| `/app/programs/[programId]` | member | Program overview, units |
| `/app/programs/[programId]/[unitId]` | member | Unit player |
| `/app/programs/[programId]/[unitId]/activity` | member | Structured activity form |
| `/review/content` | reviewer | `content_v10` sign-off rows and previews |

Every member route: add to `MEMBER_ROUTES` in `tests/member-boundary.test.ts` and to `src/lib/app/route-register.ts`. Mobile: `GET /api/mobile/v1/practices?type=skill` works via 3.1; add `GET /programs`, `GET /programs/:id`, `POST /programs/:id/enroll`, `POST /programs/:id/leave`, `POST /programs/:id/units/:unitId/complete`, `POST /activity-entries`, `DELETE /activity-entries/:id`, and document all in `openapi.yaml`.

Navigation: Skills and Listen sit under the existing Activities surface. Programs is one new entry in the member shell per Handoff 09 conventions. SOS remains on every screen including unit players.

---

## 4. Phase 1

### 1A. Skills library (critical path)

**What:** 18 KB techniques rendered as member-facing, step-through skills. Content in `10-content-pack.md` section 1.

**Selection logic:** grounding, stabilization, and a small cognitive and values set. Excluded from the member library, and why:
- `dbt-temperature` (cold water): temperature-shock skills can function as a pain substitute in a population where self-harm history is common. Stays companion-only pending clinician row CV10_A04.
- `somatic-butterfly-hug`: removed in P0.
- `emdr-*` entries: session-scoped; they belong in the session modules.
- Exposure-informed, Jungian, psychodynamic, Gestalt, and parts-dialogue entries: reflective or activating work that benefits from a clinician. Stay companion-only.

**Build:**
1. Add `SKILLS: Practice[]` to `practices.ts` from content pack section 1, including gating fields copied from the source KB entry except where the content pack overrides.
2. Skill player component: one step per screen, Back / Continue / Stop, `minSeconds` respected, voice toggle using existing `useSpeech`. Stop returns to the library with no confirmation dialog and no "are you sure."
3. Completion posts through `recordPracticeCompletion` (type `skill`).

**Acceptance:**
- A member at `GROUNDING_ONLY` sees only the 4 grounding skills.
- A member with unknown activation sees only skills with `maxActivation >= 10` (none in this set except `somatic-orientation`), which is correct by `KB_UNKNOWN_STATE_CONSERVATIVE`.
- A skill whose sign-off row is not approved is absent outside demo.
- Companion `suggest_practice` for a gated skill returns nothing.

### 1B. Program: Moving Toward (Behavioral Activation) (critical path)

Content: `10-content-pack.md` section 2. Four units:
1. What low energy does, and why action comes first (lesson L8 + values pick)
2. A short menu (activity plan: choose 1 to 3 small activities, optional day)
3. Try it and notice (activity reflect: did / partly / not this time, plus optional mastery 0 to 10 and enjoyment 0 to 10)
4. Keep it going (plan the next small set, relapse-proof tips)

**Gating proposal (clinician decides, row CV10_B02):** the KB puts BA at `STEADY` tier and ceiling 4, which would keep it away from most low-mood members. Proposed: units 1 and 2 at `STABILIZATION`, ceiling 6; units 3 and 4 at `CAUTIOUS`, ceiling 6; the activity menu at `STABILIZATION` shows only the "gentle" category. Ship with KB values until the row is signed.

**Activity reflect** never asks why something did not happen, never shows a completion count, and treats "not this time" as useful information ("That tells us the step was a bit big. Want to make it smaller?").

**Care path:** add `supportingProgramIds?: ProgramId[]` to `CareTrack`. Add `moving-toward` to `depression_adjunct` and `anxiety_panic` (as secondary). Propose updated evidence note for `depression_adjunct` in row CV10_B04; do not change the grade in code until signed.

**PHQ-9 item 9:** routing unchanged. Test that enrolling in or completing BA does not alter any item-9 path.

### 1C. Program: Steadier Sleep

Content: `10-content-pack.md` section 3. Four units:
1. How stress and sleep feed each other (lesson L5 + wind-down plan)
2. The bed is for sleep (stimulus control guidance + sleep window: preferred wake time only)
3. When nights are rough (new practices "After a bad dream" and "Back to rest")
4. Keeping what works

**Entry screen** `sleep-entry-v1`, deterministic, three yes/no items:
- Ever had a period of days with very little sleep but lots of energy, where others noticed a change in you
- Told you stop breathing, gasp, or snore loudly in your sleep, or you nod off while driving
- A seizure condition, or a health reason to avoid getting out of bed at night

Any yes: unit 2 is withheld, the member sees "Some of this program is worth talking over with a doctor first" with the rest of the program available. Coded event only. Row CV10_C04.

**Excluded:** sleep restriction and sleep compression. They reduce time in bed and are not appropriate self-guided for this population. Row CV10_C03 records the exclusion.

### 1D. Lessons 8 to 15

Content: `10-content-pack.md` section 4. Add to `LESSONS` in `lessons.ts` with `signoffRowId`. Add `relatedProgramIds?: ProgramId[]` to `Lesson`.

| Id | Title | Related |
|---|---|---|
| `always-on-alert` | When your body stays on alert | grounding skills |
| `shame` | Shame and the harsh inner voice | self-compassion skills |
| `anger` | Anger makes sense | STOP, urge surfing |
| `feeling-far-away` | Feeling far away | orientation, contact points |
| `stress-and-sleep` | Stress and sleep | steadier-sleep |
| `trust-and-closeness` | Trust and closeness | feeling-and-relating |
| `coping-that-costs` | Coping that costs more later | urge surfing |
| `action-before-motivation` | Action before motivation | moving-toward |

### 1E. Produced audio and soundscapes

**Recorded voice.** Implements README §14.6. Record the 10 highest-use scripts first (candidate list in content pack section 5) and all 15 lessons. Assets are referenced by `audioAssetId`; on-device TTS stays as the fallback and the text stays on screen.

**Asset spec:**
- Mono, or stereo with identical channels. Reject any file whose L/R correlation is below 0.99 (CI check, section 8).
- Normalized to -16 LUFS, no music bed under guided voice.
- Filenames and metadata carry `script_id` and `script_version`; if a script's text changes, its audio is marked stale and TTS is used until re-recorded.

**Soundscapes** (`type: "soundscape"`, already in the union): 4 at launch (rain, gentle stream, distant ocean, quiet room tone). Non-rhythmic, no pulses, no binaural or isochronic content, no panning. Loop seamlessly, 10 to 60 minute timer, fade out. Licensed or commissioned with written rights (founder action F4).

**Player guard:** the soundscape and narration players may not use `StereoPannerNode`, `PannerNode`, or per-channel gain. Test in section 7.

---

## 5. Phase 2 (requires sign-off before visible outside demo)

### 2A. Program: Feeling and Relating (complex-trauma skills)

Informed by the skills phase of STAIR (Cloitre and colleagues). **Not** a STAIR implementation and never named as one to members. Original content only; do not reproduce manual text. Content pack section 6 has unit outlines and member copy.

Eight units: noticing feelings, naming them, feelings and the body, riding intensity, the rules we learned about people, saying what you need, flexibility in relationships, kindness toward yourself.

Gating proposal: units 1 to 4 at `STABILIZATION` ceiling 6; units 5 to 8 at `CAUTIOUS` ceiling 5; `imagery: false` throughout. Program-level: available on the `complex_readiness` path only when that path's clinician review is satisfied, and on `ptsd_trauma` generally. Rows CV10_D01 to D03.

Activities in units 5 to 7 are reflection prompts about **current** relationships only. Copy explicitly steers away from recounting past events.

### 2B. Thought records (member)

A member version of the clinician-side `ThoughtRecorder`, as `activity: "thought-record"`. Fields in content pack section 7:
situation (recent, everyday), feeling and strength 0 to 10, the thought, what supports it, what doesn't, a more balanced thought, feeling strength now.

- Gating: `CAUTIOUS` tier, ceiling 6 (from `cbt-thought-noticing`, `cbt-evidence-for-against`).
- The situation prompt says "something from the last few days." If the crisis pre-filter matches, the standard interrupt runs.
- Entries are the member's only. Not visible to clinicians, not given to the companion.
- Row CV10_D04.

### 2C. Program: Riding Strong Feelings (DBT-informed)

Four units built mostly from live 1A skills plus new unit text (content pack section 8): stop before reacting, soothe and wait, ride the urge, make room. Gating per underlying skills. Row CV10_D05.

---

## 6. Phase 3: clinician-assigned lane (containers only)

**Status: PARKED.** Build only after all of:
1. Handoff 03 activation gate satisfied (it is marked PARKED / DO NOT IMPLEMENT).
2. A signed provider partner (evolvedMD or equivalent) whose clinicians assign and review.
3. Licensed protocol content supplied by that partner or the protocol owner. This handoff contains **no** protocol content for WET, CPT, or IRT and none should be written from memory.
4. HIPAA posture, BAA, and Postgres cutover (README §14.5) complete for the environment.

**Use Handoff 03's `ModuleDefinition` shape. Do not build a second module platform.** Stubs:

```ts
{ moduleId: "wet-v1", title: "Written exposure (clinician-assigned)",
  category: "trauma_processing", clinicalLane: "clinician_assigned",
  expectedMinutes: 30, requiredGates: ["active_assignment", "tier>=STEADY", "no_crisis_today"],
  contraindicationRuleIds: ["active_crisis", "high_dissociation"],
  outcomeMeasureIds: ["pcl-5"], contentOwner: "<partner>", clinicalReviewId: "CV10_E02",
  state: "draft" }
{ moduleId: "cpt-worksheets-v1", ... clinicalReviewId: "CV10_E03" }
{ moduleId: "irt-nightmares-v1", ... clinicalReviewId: "CV10_E04" }
```

**Lane rules (row CV10_E01):**
- Not listed anywhere unless an active assignment exists for this member. Deep links without an assignment return the not-available state.
- Assignment expires; expired assignments cannot be started.
- Distress 0 to 10 before and after every run. If after exceeds before by 3 or more, or exceeds 7, show grounding and SOS, and flag to the assigning clinician's attention queue (Handoff 09 task-provider contract, after its own gate).
- Stop is always available and never penalized.

**Narrative content (WET, IRT):**
- Encrypted, visible only to the member and the assigning clinician.
- **Excluded from the companion completely**: not in prompts, memory, tools, or summaries. Test asserts no companion code path can read `clinician_assigned` payloads.
- Retention and deletion per the partner's record policy, documented before activation.

---

## 7. Tests to add

| Test | Asserts |
|---|---|
| `kb-no-bls-shape.test.ts` | P0 regex over KB, practices, skills, programs, lessons |
| `skills-gating.test.ts` | Tier, ceiling, imagery, unknown-state filtering; deep link to gated skill |
| `content-signoff.test.ts` | Unsigned items absent outside demo across list, get, API, companion |
| `programs.test.ts` | Unlock order, re-gating per unit, leave and re-enroll, no counts in view models |
| `activity-free-text.test.ts` | Crisis pre-filter runs before persist; `enc1:` at rest; delete works |
| `companion-program-readonly.test.ts` | No companion tool writes program or activity tables; `suggest_practice` respects gates |
| `companion-excludes-assigned.test.ts` | Phase 3 payloads unreachable from companion (write now, it guards the future) |
| `sleep-entry.test.ts` | Any yes withholds unit 2 only; coded event only |
| `audio-no-panning.test.ts` | Players contain no panner or per-channel gain; asset L/R correlation check script exists |
| `phq9-item9-unchanged.test.ts` | BA enrollment or completion does not alter item-9 routing |
| `member-boundary.test.ts` (edit) | New routes listed; guard still fails on unlisted `/app` routes |

Add all of the above to `npm run test:safety`.

---

## 8. CI changes

1. **Extend the banned-vocabulary grep** in `.github/workflows/safety.yml`. It scans `src/app` and `src/components` only, so content in `src/lib/practices.ts`, `lessons.ts`, `programs.ts` and future content files is unscanned today. Add `src/lib/practices.ts src/lib/lessons.ts src/lib/programs.ts src/lib/content/**` with `--include="*.ts"`.
2. **Add modality names to the member-copy check** for these same files: `\b(DBT|ACT|STAIR|CBT-I|EMDRIA)\b` fails in member-facing string fields (allow in comments and `signoffRowId`).
3. **Audio asset check** script `scripts/check-audio-mono.ts`: for every file under the audio asset directory, compute L/R correlation; fail below 0.99.

---

## 9. Sign-off rows

Full text in `10-clinician-signoff.docx`. Row ids are the `content_v10` catalog ids.

| Lane | Rows | Reviewer |
|---|---|---|
| A. Trauma-informed clinical content | CV10_A01 to A17 | Licensed psychologist with trauma experience |
| B. Behavioral activation | CV10_B01 to B05 | Psychologist with CBT / BA experience |
| C. Sleep | CV10_C01 to C05 | Clinician trained in CBT-I or behavioral sleep medicine |
| D. Complex trauma skills (Phase 2) | CV10_D01 to D05 | Clinician with complex trauma / phase-based experience |
| E. Clinician-assigned lane (Phase 3) | CV10_E01 to E05 | Partner clinical lead |
| F. Licensing and compliance | CV10_F01 to F05 | Founder with counsel (not clinical) |

Default for every unsigned row: **does not ship.**

---

## 10. Sequencing for Claude Code

| Order | Package | Depends on | Rough size |
|---|---|---|---|
| 1 | P0 fix + `kb-no-bls-shape` test | none | 1 session |
| 2 | 3.3 content sign-off plumbing + `/review/content` | none | 1 session |
| 3 | 3.1 skill type + gated `listPractices` + skill player | 2 | 1 to 2 sessions |
| 4 | 1A content load | 3 | 1 session |
| 5 | 3.2 programs model, tables, spine events, routes | 2 | 2 sessions |
| 6 | 3.4 free-text pipeline + 3.5 companion tool | 5 | 1 session |
| 7 | 1B Moving Toward | 5, 6 | 1 to 2 sessions |
| 8 | 1D lessons | 2 | 1 session |
| 9 | 1C Steadier Sleep | 5, 6, 8 | 1 to 2 sessions |
| 10 | CI changes (section 8) | 4, 7, 8 | 1 session |
| 11 | 1E audio pipeline and soundscapes | assets (F4) | 1 to 2 sessions |
| 12 | Phase 2 (2A, 2B, 2C) | 5, 6, D-lane rows | 3 to 4 sessions |
| 13 | Phase 3 containers | section 6 prerequisites | not scheduled |

Each package ends with `npm run test:safety` and the e2e suite green, and an update to `route-register.ts` and the README RESUME block.

---

## 11. Founder decisions and actions

1. **Clinician reviewers.** Lanes A to D need 2 to 4 people. Your two psychologists can likely cover A and B; C and D may need additions.
2. **F1:** confirm sleep measure licensing before 1C adds a measure.
3. **F2:** approve member-facing program names (Moving Toward, Steadier Sleep, Feeling and Relating, Riding Strong Feelings).
4. **F4:** voice talent and soundscape rights. Budget roughly 25 recorded scripts.
5. **Phase 3 partner.** The containers are only worth building once a partner will assign.

## 12. Out of scope

Sleep restriction; self-guided trauma narrative or expressive writing about past events; IFS parts dialogue; dream interpretation; any binaural, panned, or rhythmic entrainment audio; licensed music; clinician visibility of member free text outside Phase 3 assignments; backfilling gating onto the existing 20 practices.
