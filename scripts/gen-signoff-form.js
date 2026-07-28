const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
  Header, Footer, PageNumber, LevelFormat,
} = require("docx");

const CFG_VERSION = "beta-clinrev-2026-07";
const PRIOR_VERSION = "beta-provisional-2026-07";

// Pre-filled reviewers (provided by the founder; credentials verified against
// the state board record). Signature + date + EMDR-cert left blank for them.
const REVIEWERS = [
  { name: "Rebecca Altschuler", title: "Licensed Psychologist", license: "Psychologist — PSY-005804 (Active, exp. 02/29/2028; no board actions)", juris: "Arizona (Phoenix)" },
  { name: "John Allen", title: "Licensed Psychologist", license: "Psychologist — PSY-002055 (Active, exp. 08/31/2027; no board actions)", juris: "Arizona (Tucson)" },
];
const PAGE_W = 12240, PAGE_H = 15840;         // US Letter (DXA)
const CONTENT_W = 12240 - 1440 - 1440;        // 1" margins => 9360 DXA

// ---- palette -------------------------------------------------------------
const INK = "1F2933", MUTE = "5B6b7a", RULE = "9AA5B1";
const HEADBG = "1F3A5F", HEADFG = "FFFFFF";
const ZEBRA = "F0F3F7", FILLBLANK = "FFFDE7", REDBG = "FBE9E7", AMBERBG = "FFF8E1";

// ---- helpers -------------------------------------------------------------
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const cellBorders = () => {
  const b = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  return { top: b, bottom: b, left: b, right: b };
};
function txt(text, o = {}) {
  return new TextRun({ text, font: "Calibri", size: o.size ?? 20, bold: o.bold, italics: o.italics, color: o.color ?? INK });
}
function p(runs, o = {}) {
  return new Paragraph({
    alignment: o.align, spacing: { after: o.after ?? 80, before: o.before ?? 0, line: o.line ?? 264 },
    children: Array.isArray(runs) ? runs : [runs], ...o.extra,
  });
}
function cell(children, o = {}) {
  return new TableCell({
    width: { size: o.w, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    verticalAlign: o.valign ?? "top",
    columnSpan: o.span,
    children: Array.isArray(children) ? children : [children],
  });
}
function headRow(labels, widths) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) =>
      cell([p(txt(l, { bold: true, color: HEADFG, size: 18 }), { after: 0 })], { w: widths[i], fill: HEADBG })),
  });
}
function table(widths, rows) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 4, color: RULE }, right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    },
    rows,
  });
}
const CHECK = "☐"; // ballot box
function verdictRuns() {
  return [
    new TextRun({ text: CHECK + " Agree    ", font: "Calibri", size: 18 }),
    new TextRun({ text: CHECK + " Needs-change", font: "Calibri", size: 18 }),
  ];
}
function h(text, level) {
  return new Paragraph({
    heading: level, spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: "Calibri", bold: true, color: INK })],
  });
}
function blankLine(label, o = {}) {
  // underscore fill line with a leading label
  return p([
    txt(label + "  ", { bold: true, color: MUTE, size: 18 }),
    txt("_".repeat(o.len ?? 60), { color: RULE }),
  ], { after: o.after ?? 140 });
}

// ---- data: the numeric conflicts (ledger Section A) ----------------------
// "Applied" = the clinical-review decision now implemented in the code at this
// config version. Clinicians confirm or revise each in the right-hand column.
const SECTION_A = [
  ["A1", "RED", "Readiness formula", "Weighted 0–100 (main body) vs multiplier-based (Appendix A)", "Renamed to “Educational Access State”. No composite score represented as clinical readiness; explicit domain gates (current safety, orientation, pause/stop capacity). Score may only rank permitted educational options — never authorizes trauma processing."],
  ["A2", "RED", "In-session SUDS rule", "Delta-based (+1 / +2) vs absolute (≥8 / ≥9 + rise-of-3)", "Conservative union retained as automatic STOP/closure FAIL-SAFES only (not a substitute for assessment). User-initiated stop any time; loss of orientation overrides SUDS; no further stimulation after a stop in the same session."],
  ["A3", "AMBER", "Session duration", "30 / 40 min vs 35 / 45 min", "Autonomous reprocessing/BLS DISABLED in beta. 30/40 min retained only as upper operational bounds; set-specific + cumulative exposure limits defined separately only for a future validated protocol."],
  ["A4", "AMBER", "Containment-ending cooldown", "48 h vs 24 h", "Fixed 48 h not asserted as authoritative. Minimum conservative rest + fresh check-in + human review after containment-ending events; exact interval pending evidence/pilot."],
  ["A5", "AMBER", "Max stimulation sets", "3 vs 2–3 vs 2", "No autonomous processing sets in beta. Self-tapping remains only as an optional grounding/orienting skill (not memory processing). “2” kept as a future upper bound only."],
  ["A6", "AMBER", "Hospitalization exclusion window", "0–90 d / 91–365 review vs 12-mo standing", "Blanket 12-month exclusion REMOVED. Recent hospitalization → restricted access pending HUMAN REVIEW (current stability, discharge plan, safety, support), not a universal calendar rule."],
  ["A7", "RED", "BLS speed & closure minimum", "1.25 Hz / 120 s; advisor: “nothing ships without this row”", "NO autonomous BLS in beta; visual BLS disabled. Speed alone cannot establish safety — set duration, modality, visual safety, consent, stop access, orientation checks, and purpose remain unresolved. Not ratified."],
  ["A8", "RED", "Program-fit item wording", "fit-v1-placeholder — not final", "Finalized wording applied (fit-v2-clinrev): “Steady provides education, preparation, and grounding-oriented skills. It does not diagnose, determine readiness for trauma processing, or replace a licensed clinician…” Responses: Yes / I am not sure / No, I need urgent or clinical help."],
  ["A9", "AMBER", "DES-II inclusion & licensing", "Not selected; licensing unverified", "DES-II NOT surfaced/scored in beta (des2SurfaceEnabled = false) until lawful licensing, scoring fidelity, interpretation limits, and clinician workflow are confirmed. If adopted → caution/referral only."],
  ["A10", "AMBER", "State vs trait split", "Advisor R18", "Current-state reports stored separately from trait/history; history is source-labeled and does not by itself impose a permanent restriction; user correction + clinician review supported. (Full state/trait datastore split is a tracked follow-up.)"],
];

// ---- data: deterministic rule register (B/C/D) ---------------------------
// [id, plain-language threshold to ratify]
const RULES_GATING = [
  ["FIT_UNDER_18", "Under 18 → not eligible (adults 18+ only). [unchanged]"],
  ["FIT_SELFHARM_30D", "REVISED: self-harm HISTORY (30 d) alone → grounding + present-safety clarification + referral (no automatic crisis/refund). Urgent routing only on current intent."],
  ["FIT_UNSAFE_SITUATION", "REVISED: current-unsafe → crisis floor + present-safety clarification branched by type, with jurisdiction-aware resources (not one generic script)."],
  ["FIT_PSYCHOTIC_DISSOCIATIVE_DX", "REVISED: diagnosis → restricted access pending HUMAN REVIEW (orientation/stability/support/intended use). No permanent autonomous ban."],
  ["FIT_HOSPITALIZATION_12M", "REVISED: hospitalization history → restricted pending HUMAN REVIEW (current stability, discharge plan, support). No fixed 12-mo calendar exclusion."],
  ["FIT_SUBSTANCE_DEPENDENCE", "REVISED: dependence history → HUMAN REVIEW (not permanent exclusion). Current intoxication/withdrawal handled by the daily rules."],
  ["FIT_SEIZURE_PHOTOSENSITIVE", "Seizure / photosensitivity → visual movement disabled for the account. [unchanged]"],
  ["FIT_ACUTE_MEDICAL", "REVISED: acute medical → grounding only + urgent MEDICAL referral for red-flags; no activating work while unresolved."],
  ["ACUTE_TRAUMA_30D", "REVISED: retain no-BLS + grounding; 30 d is a review trigger (current-state/clinician review gates any later activating path), not a universal boundary."],
  ["DAILY_HARM_URGE", "REVISED: crisis floor + graduated present-safety clarification (current intent / ability to stay safe / action taken) + jurisdiction-aware resources."],
  ["DAILY_NOT_SAFE", "REVISED: urgent, with a specified pathway — jurisdiction-aware resources + truthful human-notification status (never imply a human was contacted unless confirmed)."],
  ["CRISIS_PHQ9_ITEM9", "REVISED: nonzero item 9 → stabilization + present-risk clarification + safety question + referral. NO standalone fixed 72 h lockout."],
  ["PCL5_ITEM16_CONTEXT", "REVISED (was CRISIS_PCL5_ITEM16): item 16 = risk-taking, NOT a suicide proxy. De-scoped from safety routing → context prompt / review trigger only; no lockout."],
  ["DAILY_DISSOCIATION_7", "REVISED: ≥ 7 → grounding + present-orientation check + clarification (review trigger). Hard stops are loss of orientation / inability to follow a stop, not the number alone."],
  ["DAILY_ACTIVATION_8", "REVISED: ≥ 8 → grounding-only default (review trigger); scale defined; member may stop at any score."],
  ["DAILY_SHUTDOWN_8", "REVISED: ≥ 8 → low-demand orientation + clarification (review trigger); “shutdown” + anchors defined."],
  ["DAILY_INTOXICATION", "Current intoxication → activating work rests, grounding open. [unchanged]"],
  ["DAILY_DISSOCIATION_4", "REVISED: 4–6 → caution → grounding + present-orientation check (review trigger)."],
  ["DAILY_SLEEP_LOW", "REVISED: low sleep → cautious pacing + brief current-impairment check (review trigger), not a universal stabilization restriction."],
  ["DAILY_SUBSTANCE", "REVISED: same-day substance flag → lower intensity + clarification (review trigger); distinguishes current intoxication from historical/prescribed use."],
  ["MISSING_CHECKIN", "No check-in today → grounding only until completed (missing input never favorable). [unchanged]"],
  ["DES2_HIGH", "REVISED: INERT in beta — DES-II omitted until licensed + validated (des2SurfaceEnabled = false). If adopted → caution/referral only."],
  ["DES2_CAUTION", "REVISED: INERT in beta — DES-II omitted until licensed + validated."],
  ["PCL5_WEEKLY_RISE_10", "REVISED: ≥ 10 rise → REVIEW TRIGGER + fresh check-in + referral; no automatic 14-day ceiling."],
  ["ITQ_COMBINED_RISE_8", "REVISED: ≥ 8 rise → REVIEW TRIGGER + fresh check-in + referral; no automatic 14-day ceiling."],
  ["READY_RISK_FLAG", "Any active safety flag → route to support first. [unchanged; now under Educational Access State]"],
  ["READY_LESS_THAN_SAFE", "REVISED: current-safety domain gate → steadying range. Relabeled Educational Access State (not a readiness score)."],
  ["READY_PAUSE_CAPACITY_LOW", "REVISED: low pause/stop capacity → practice stop/pause controls first (cautious). Not a permanent trait or clinical-readiness label."],
  ["REENTRY_PENDING", "Return after a rest → fresh check-in + grounding, access opens gradually. [unchanged]"],
];
// NOTE: beta runs NO autonomous BLS / reprocessing. The rows below are retained
// as fail-safe stops / upper bounds only; they do not authorize autonomous sets.
const RULES_SESSION = [
  ["SESSION_START_SUDS_CEILING", "[No autonomous BLS in beta] Future protocol only: deny stimulation if starting SUDS > 5, plus orientation/consent/stop-capacity/clinician context."],
  ["SESSION_MAX_SETS", "[No autonomous sets in beta] Upper bound of 2 is incomplete without per-set duration, modality, purpose, stop checks, aftercare. Self-tapping = grounding only."],
  ["SESSION_CONTAINMENT_DELTA", "Fail-safe: containment if post-set SUDS rises by ≥ 2."],
  ["SESSION_CONTAINMENT_ABSOLUTE", "Fail-safe: containment if post-set SUDS reaches ≥ 8."],
  ["SESSION_HARD_STOP_SUDS", "Fail-safe: hard-stop containment if SUDS reaches ≥ 9."],
  ["SESSION_RISE_OVER_START", "Fail-safe: containment if SUDS rises ≥ 3 over the starting value."],
  ["SESSION_TWO_RISES", "Fail-safe: containment after two consecutive +1 rises."],
  ["SESSION_NO_CHANGE", "Fail-safe: close if SUDS unchanged across 2 sets (“stuck is a stop signal”)."],
  ["SESSION_DISSOCIATION_STOP", "REVISED: hard stop on a defined dissociation scale (≥ 4) OR loss of orientation OR inability to follow a stop; numeric elevation → reorient, no further sets."],
  ["SESSION_ORIENTATION_STOP", "Stop + re-orient if not oriented to the present (overrides SUDS)."],
  ["SESSION_WIND_DOWN", "REVISED: 30 min is an upper operational boundary only — not evidence of safe processing."],
  ["SESSION_HARD_STOP_TIME", "REVISED: 40 min is an absolute ceiling only; does not authorize activity inside the window."],
  ["SESSION_CLOSURE_MIN", "REVISED: 120 s is a FLOOR, not sufficient — closure also requires orientation confirmation + member-reported stability + an escalation path if closure fails."],
  ["SESSION_GROUND_ME", "Ground-Me: one-tap halt, locks stimulation for the session, no return; user stop available any time."],
  ["BLS_HZ", "REVISED: DISABLED in beta. If later validated, 1.0–1.5 Hz (default 1.25), no adaptive speed; speed alone cannot establish safety."],
  ["BLS_NO_VISUAL_BETA", "No visual BLS in beta (auditory + self-tapping only); visual stays disabled."],
  ["BLS_FLASH_CEILING", "Visual flashes never exceed 3 / sec (WCAG 2.3.2)."],
  ["BLS_TIMING_FAILURE", "On a timing failure: stop the set; never catch up or resume."],
];
const RULES_EXPERIENCE = [
  ["VOICE_INPUT_ENABLED", "Voice answers a free-text reflection; typing always available (equivalent typed path)."],
  ["VOICE_INPUT_ON_DEVICE", "On-device transcription; raw audio never uploaded/stored; only confirmed transcript kept (encrypted)."],
  ["VOICE_INPUT_CONFIRM", "Recognized text is shown editable; member confirms before it enters the record."],
  ["VOICE_INPUT_SCOPE", "Voice only for free-text reflection — never SUDS, fit-screening, or any safety-gate input."],
  ["VOICE_INPUT_CONSENT", "Distinct versioned voice/biometric consent + counsel review before non-demo use."],
  ["LIVE_SESSION_ENGINE_OWNS_FLOW", "Responder returns words + at most a Ground-me hint; never continues a set / ends closure / overrides a stop."],
  ["LIVE_SESSION_CRISIS_SCRIPTED", "REVISED: crisis checked first; deterministic (never AI). Response = present-safety clarification + verified jurisdiction-aware resources + emergency guidance for immediate danger + truthful notification status — not one universal 988 script."],
  ["LIVE_SESSION_BOUNDED_RESPONSE", "Never instructs reprocessing, never claims feelings/outcomes; every line passes the output guard."],
  ["LIVE_SESSION_DEMO_GATED", "Off for real members (demo/flag only); needs clinician sign-off + voice consent."],
];
const RULES_KB = [
  ["KB_ADVISORY_ONLY", "Therapy KB is advisory to phrasing only; never makes/changes a safety decision."],
  ["KB_TIER_GATED", "Retrieval gated by member tier/state; crisis tier gets no KB content."],
  ["KB_OUTPUT_GUARDED", "Every KB-informed line still passes the deterministic output guard."],
  ["KB_RESTRICTED_TOPICS", "Restricted topics (reprocessing instructions, etc.) never retrievable."],
  ["KB_DETERMINISTIC_RETRIEVAL", "Retrieval is deterministic (tier/activation/dissociation-gated), not model-chosen."],
  ["KB_AVOIDWHEN_ADVISORY", "“Avoid-when” conditions on techniques are honored as hard filters."],
  ["KB_UNKNOWN_STATE_CONSERVATIVE", "Unknown/missing state → most conservative retrieval (or none)."],
];

// ---- Section E validation gates ------------------------------------------
const SECTION_E = [
  ["RED", "Independent review by ≥ 2 licensed trauma clinicians of scope / thresholds / stop-rules / dissociation / crisis-routing / user language."],
  ["RED", "Evidence matrix mapping every parameter to supporting / absent evidence."],
  ["RED", "Clinical implementation spec (decision tables, state transitions, pseudocode, test cases)."],
  ["RED", "Privacy / security review by qualified professionals (separate from clinical design)."],
  ["AMBER", "Human-factors testing (comprehension, interruption recovery, behavior under stress)."],
  ["AMBER", "Technical verification (deterministic routing, logging, crash recovery, regression)."],
  ["RED", "Staged validation Phases 1→4 with predefined progression / stopping criteria."],
  ["RED", "Claims / communications review — preparation-only scope consistent across all channels."],
  ["RED", "Model safety gates + pilot entry: no unresolved critical red-team findings."],
];

// ==========================================================================
// Build a rule-ratification table for a group
function ruleTable(rows) {
  const W = [1560, 3560, 1440, 2800]; // id, threshold, verdict, required-change == 9360
  const trs = [headRow(["Rule ID", "Threshold / behavior to ratify", "Verdict", "If Needs-change: state the required change"], W)];
  rows.forEach((r, i) => {
    const fill = i % 2 ? ZEBRA : undefined;
    trs.push(new TableRow({
      children: [
        cell([p(txt(r[0], { bold: true, size: 16 }), { after: 0 })], { w: W[0], fill }),
        cell([p(txt(r[1], { size: 18 }), { after: 0 })], { w: W[1], fill }),
        cell([
          p(new TextRun({ text: CHECK + " Agree", font: "Calibri", size: 18 }), { after: 30 }),
          p(new TextRun({ text: CHECK + " Needs-change", font: "Calibri", size: 18 }), { after: 0 }),
        ], { w: W[2], fill }),
        cell([p(txt(" ", { size: 18 }), { after: 0 })], { w: W[3], fill: FILLBLANK }),
      ],
    }));
  });
  return table(W, trs);
}

// Section A table
function sectionATable() {
  const W = [640, 2100, 3160, 3460]; // #, param, conflict, ruling == 9360
  const trs = [headRow(["#", "Parameter", "Applied clinical-review decision (now in code)", "Confirm / revise"], W)];
  SECTION_A.forEach((r) => {
    const sev = r[1] === "RED" ? REDBG : AMBERBG;
    trs.push(new TableRow({
      children: [
        cell([p(txt(r[0], { bold: true, size: 16 }), { after: 0 })], { w: W[0], fill: sev }),
        cell([p(txt(r[2], { bold: true, size: 17 }), { after: 0 })], { w: W[1] }),
        cell([
          p(txt("Was: ", { bold: true, size: 15, color: MUTE }), { after: 0 }),
          p(txt(r[3], { size: 15, color: MUTE }), { after: 40 }),
          p([txt("Applied: ", { bold: true, size: 15, color: HEADBG }), txt(r[4], { size: 16 })], { after: 0 }),
        ], { w: W[2] }),
        cell([
          p([new TextRun({ text: CHECK + " Confirm  " + CHECK + " Revise", font: "Calibri", size: 15 })], { after: 20 }),
          p(txt(" ", { size: 14 }), { after: 0 }),
        ], { w: W[3], fill: FILLBLANK }),
      ],
    }));
  });
  return table(W, trs);
}

// Reviewer credential block. Pass `data` to pre-fill known fields.
function reviewerBlock(n, data) {
  const W = [2600, 6760];
  const row = (label, value) => new TableRow({
    children: [
      cell([p(txt(label, { bold: true, size: 18, color: MUTE }), { after: 0 })], { w: W[0], fill: ZEBRA, valign: "center" }),
      cell([p(txt(value ?? " ", { size: 18 }), { after: 0 })], { w: W[1] }),
    ],
  });
  return table(W, [
    new TableRow({ children: [cell([p(txt(`Reviewer ${n}`, { bold: true, color: HEADFG, size: 20 }), { after: 0 })], { w: W[0] + W[1], span: 2, fill: HEADBG })] }),
    row("Full name", data?.name),
    row("Professional title", data?.title),
    row("License type & number", data?.license),
    row("Jurisdiction / state", data?.juris),
    row("EMDR training / certification"),
    row("Trauma-clinical experience"),
    row("Independence attestation"),
  ]);
}

function sectionETable() {
  const W = [900, 5560, 2900];
  const trs = [headRow(["Sev.", "Deployment / validation gate", "Status + evidence reference"], W)];
  SECTION_E.forEach((r, i) => {
    const fill = i % 2 ? ZEBRA : undefined;
    trs.push(new TableRow({
      children: [
        cell([p(txt(r[0] === "RED" ? "🔴" : "🟡", { size: 16 }), { after: 0 })], { w: W[0], fill }),
        cell([p(txt(r[1], { size: 18 }), { after: 0 })], { w: W[1], fill }),
        cell([p([new TextRun({ text: CHECK + " Complete   " + CHECK + " Pending", font: "Calibri", size: 16 })], { after: 20 }),
              p(txt("Ref: ____________", { size: 15, color: MUTE }), { after: 0 })], { w: W[2], fill }),
      ],
    }));
  });
  return table(W, trs);
}

// ==========================================================================
const children = [];

// ---------- Title ----------
children.push(new Paragraph({ spacing: { after: 40 }, children: [txt("STEADY — AUTONOMOUS SAFETY SYSTEM", { bold: true, size: 22, color: HEADBG })] }));
children.push(new Paragraph({
  border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: HEADBG } },
  spacing: { after: 160 },
  children: [txt("Independent Licensed-Clinician Sign-Off Form", { bold: true, size: 34, color: INK })],
}));
children.push(p([
  txt("Configuration under review: ", { bold: true, size: 20 }),
  txt(CFG_VERSION, { size: 20, color: HEADBG, bold: true }),
], { after: 40 }));
children.push(p([txt("Date of review: ", { bold: true, size: 20 }), txt("__________________        ", { size: 20 }),
  txt("Review session / ref: ", { bold: true, size: 20 }), txt("__________________", { size: 20 })], { after: 120 }));

// Revision banner
children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: [CONTENT_W],
  borders: { top: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, bottom: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, left: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, right: { style: BorderStyle.SINGLE, size: 8, color: HEADBG }, insideHorizontal: noBorder, insideVertical: noBorder },
  rows: [new TableRow({ children: [cell([
    p([txt("Revision under review. ", { bold: true, size: 18, color: HEADBG }), txt(`This configuration (${CFG_VERSION}) supersedes ${PRIOR_VERSION} and applies a clinical-review change set. Bumping the config version has reset all prior per-rule sign-offs — every item below is unratified and needs your verdict.`, { size: 18 })], { after: 60 }),
    p(txt("Key applied changes (detail in Parts 2–3):", { bold: true, size: 17, color: MUTE }), { after: 20 }),
    p(txt("•  No autonomous bilateral stimulation / trauma-memory reprocessing in beta (self-tapping = grounding only).", { size: 17 }), { after: 10 }),
    p(txt("•  Diagnosis / hospitalization / substance HISTORY → restricted pending human review (not a standing/permanent exclusion).", { size: 17 }), { after: 10 }),
    p(txt("•  Numeric daily/worsening scores → review triggers + fresh check-in, not automatic lockouts; present-state crisis inputs keep their floor.", { size: 17 }), { after: 10 }),
    p(txt("•  PHQ-9 item 9 → present-risk clarification (no standalone fixed 72 h lockout); PCL-5 item 16 de-scoped as a suicide proxy.", { size: 17 }), { after: 10 }),
    p(txt("•  DES-II omitted until licensed + validated; crisis routing → jurisdiction-aware + truthful notification; “readiness” → Educational Access State; finalized program-fit wording.", { size: 17 }), { after: 0 }),
  ], { w: CONTENT_W, fill: "F4F7FB" })] })],
}));
children.push(p(txt(" ", { size: 10 })));

children.push(p([
  txt("Purpose. ", { bold: true, size: 20 }),
  txt("Steady's safety decisions are made by a deterministic rule engine currently running in ", { size: 20 }),
  txt("shadow mode", { bold: true, size: 20 }),
  txt(" (it computes and logs, but governs nothing a member sees). Before it may govern any real member, the clinician-authored corpus requires review and sign-off by at least two independent licensed trauma clinicians. This form is the paper record of that review. Every value below is ", { size: 20 }),
  txt("provisional", { italics: true, size: 20 }),
  txt(" until ratified here.", { size: 20 }),
]));
children.push(p([
  txt("How to use. ", { bold: true, size: 20 }),
  txt("Complete all five parts. Part 1 captures reviewer identity and credentials. Part 2 resolves the numeric conflicts the specification left open — these feed a configuration change, after which the config version increments and Part 3 is ratified against the new values. Part 3 is the rule-by-rule ratification that mirrors the in-app Autonomous Review console (“Agree / Needs-change” per rule) — you may complete it in the app instead, but this sheet gives the same coverage on paper and maps 1:1 to the console's CSV export. Part 4 is the out-of-app evidence package. Part 5 is the attestation and signatures.", { size: 20 }),
]));
children.push(p([
  txt("Legend:  ", { bold: true, size: 18, color: MUTE }),
  txt("🔴 blocks real-member use    🟡 resolve before pilot", { size: 18, color: MUTE }),
], { after: 80 }));

// ---------- Part 1 ----------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 1 — Reviewer identity & credentials", HeadingLevel.HEADING_1));
children.push(p(txt("The corpus (Vol I App. C) requires named, credentialed, signed reviewers; at least two independent licensed trauma clinicians must sign. Add pages for further reviewers.", { size: 18, color: MUTE, italics: true })));
children.push(reviewerBlock(1, REVIEWERS[0]));
children.push(p(txt(" ", { size: 8 })));
children.push(reviewerBlock(2, REVIEWERS[1]));

// ---------- Part 2 ----------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 2 — Numeric conflict resolution (ledger Section A)", HeadingLevel.HEADING_1));
children.push(p(txt("Each conflict the specification left open now has a clinical-review decision applied in code (the “Applied” column). Confirm each decision or mark Revise and state the change; the four 🔴 items block real-member use until you confirm them. A7 (BLS) is explicitly not ratified — no autonomous BLS in beta — and A8 is the finalized program-fit wording for your approval.", { size: 18, color: MUTE, italics: true })));
children.push(sectionATable());

// ---------- Part 3 ----------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 3 — Deterministic rule ratification (ledger Sections B–D)", HeadingLevel.HEADING_1));
children.push(p(txt("Confirm each immutable rule's threshold/behavior is clinically correct. Mark Agree or Needs-change for every rule; when you mark Needs-change, state the specific required change inline in the last column (add a page if you need more room). Rule IDs match the console register and CSV export at the config version above.", { size: 18, color: MUTE, italics: true })));

children.push(h("3.1  Access & gating rules (program-fit, daily routing, instruments, readiness)", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_GATING));
children.push(p([txt("Additional notes for this group (optional): ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
children.push(p(txt("_".repeat(96), { color: RULE })));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("3.2  In-session runtime & bilateral-stimulation rules", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_SESSION));
children.push(p([txt("Additional notes for this group (optional): ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
children.push(p(txt("_".repeat(96), { color: RULE })));

children.push(h("3.3  Voice input & live spoken-session guardrails", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_EXPERIENCE));
children.push(p([txt("Additional notes for this group (optional): ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
children.push(p(txt("_".repeat(96), { color: RULE })));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("3.4  Therapy knowledge-base retrieval guardrails", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_KB));
children.push(p([txt("Additional notes for this group (optional): ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
children.push(p(txt("_".repeat(96), { color: RULE })));

// Human-in-loop confirmations (Section C narrative confirmations)
children.push(h("3.5  Human-in-the-loop checkpoints — confirm none is silently removed", HeadingLevel.HEADING_2));
[
  "AI never determines crisis status, dissociation, readiness, emergency routing, stimulation parameters, or eligibility (structurally enforced).",
  "No autonomous emergency-services dispatch (out of scope for beta).",
  "Escalation never promises more human oversight than is actually staffed; never implies continuous monitoring.",
  "DES-II ≥ 30 / DSO-predominant / repeated re-entry failures route to a clinician pathway.",
  "Trait hard-stops (psychotic/dissociative dx, recent hospitalization, substance dependence) reversible only by support contact — never by re-answering.",
].forEach((t) => children.push(p([new TextRun({ text: CHECK + "  ", font: "Calibri", size: 20 }), txt(t, { size: 18 })], { after: 60 })));

// ---------- Part 4 ----------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 4 — Validation & deployment evidence (ledger Section E)", HeadingLevel.HEADING_1));
children.push(p(txt("These deliverables are produced outside the app. Record status and where the evidence lives.", { size: 18, color: MUTE, italics: true })));
children.push(sectionETable());

// ---------- Part 5 ----------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 5 — Attestation & signatures", HeadingLevel.HEADING_1));
children.push(p([
  txt("By signing, each reviewer attests that: they are an independent, licensed clinician with trauma expertise; they have reviewed the scope, thresholds, stop-rules, dissociation handling, crisis routing, and member-facing language of the configuration named above; the “Agree” verdicts recorded here reflect their clinical judgment; and any “Needs-change” items must be resolved and re-reviewed before that rule governs a real member. This sign-off applies only to configuration version ", { size: 20 }),
  txt(CFG_VERSION, { bold: true, size: 20 }),
  txt("; any change to a signed value resets its sign-off.", { size: 20 }),
]));
children.push(p(txt("Overall determination:", { bold: true, size: 20 }), { before: 120, after: 60 }));
[
  "Approved to proceed to staged activation (all 🔴 items resolved, all rules Agree).",
  "Approved with conditions (list the blocking Needs-change / open items below).",
  "Not approved.",
].forEach((t) => children.push(p([new TextRun({ text: CHECK + "  ", font: "Calibri", size: 22 }), txt(t, { size: 20 })], { after: 60 })));
children.push(blankLine("Conditions / open items:", { len: 74, after: 60 }));
children.push(p(txt("_".repeat(96), { color: RULE }), { after: 200 }));

// signature lines ×2
function sigBlock(n) {
  const W = [4560, 4800];
  return table(W, [
    new TableRow({ children: [
      cell([p(txt("_".repeat(40), { color: INK }), { after: 20 }), p(txt(`Reviewer ${n} — signature`, { size: 16, color: MUTE }), { after: 0 })], { w: W[0] }),
      cell([p(txt("_".repeat(26), { color: INK }), { after: 20 }), p(txt("Printed name / license #", { size: 16, color: MUTE }), { after: 0 })], { w: W[1] }),
    ] }),
    new TableRow({ children: [
      cell([p(txt("_".repeat(24), { color: INK }), { after: 20 }), p(txt("Date", { size: 16, color: MUTE }), { after: 0 })], { w: W[0] }),
      cell([p(txt(" ", { size: 16 }), { after: 0 })], { w: W[1] }),
    ] }),
  ]);
}
children.push(sigBlock(1));
children.push(p(txt(" ", { size: 10 })));
children.push(sigBlock(2));

// ==========================================================================
const doc = new Document({
  creator: "Steady",
  title: "Steady Autonomous Safety — Clinician Sign-Off Form",
  styles: {
    default: { document: { run: { font: "Calibri", size: 20, color: INK } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, color: HEADBG, font: "Calibri" },
        paragraph: { spacing: { before: 280, after: 140 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RULE } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, color: INK, font: "Calibri" },
        paragraph: { spacing: { before: 200, after: 100 } } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT, spacing: { after: 0 },
      children: [txt("Steady — Clinician Sign-Off Form  ·  " + CFG_VERSION, { size: 14, color: MUTE })],
    })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 0 },
      children: [
        new TextRun({ text: "Confidential clinical governance record — ", font: "Calibri", size: 14, color: MUTE }),
        new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: "Calibri", size: 14, color: MUTE }),
      ],
    })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(process.argv[2], buf);
  console.log("wrote", process.argv[2], buf.length, "bytes");
});
