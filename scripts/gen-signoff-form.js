const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, PageBreak,
  Header, Footer, PageNumber, LevelFormat,
} = require("docx");

const CFG_VERSION = "beta-provisional-2026-07";
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
const SECTION_A = [
  ["A1", "RED", "Readiness formula", "Weighted 0–100 (main body) vs multiplier-based (Appendix A) — different caps, track names, boundaries", "Multiplier + caps; tracks grounding / cautious / steady (caps are the safety mechanism: <fully-safe → ceiling 30; low pause-capacity → ceiling 60)"],
  ["A2", "RED", "In-session SUDS rule", "Delta-based (+1 pause / +2 containment) vs absolute (≥8 / ≥9 + rise-of-3, App A)", "Conservative UNION: containment on Δ≥2 OR absolute ≥8 OR rise-≥3-over-start; hard-stop at ≥9"],
  ["A3", "AMBER", "Session duration", "30 / 40 min (main) vs 35 / 45 min (App A + advisor R4)", "30 min wind-down / 40 min hard-stop (shorter)"],
  ["A4", "AMBER", "Containment-ending cooldown", "48 h (main + crosswalk) vs 24 h (advisor R21)", "48 h (longer)"],
  ["A5", "AMBER", "Max stimulation sets", "3 (main) vs 2–3 (advisor) vs 2 (beta)", "2"],
  ["A6", "AMBER", "Hospitalization exclusion window", "0–90 d / 91–365 review (main) vs 12-mo standing (screener)", "12-month standing (more conservative)"],
  ["A7", "RED", "BLS speed & closure minimum", "Main lists 1.25 Hz / 120 s; advisor worksheet marks BOTH “none in codebase — nothing ships without this row”", "Beta 1.0 / 1.25 / 1.5 Hz range, 3/s flash ceiling, 120 s closure — PLACEHOLDERS pending this sign-off"],
  ["A8", "RED", "Program-fit item wording", "Placeholder pending advisor R15", "fit-v1-placeholder — NOT final"],
  ["A9", "AMBER", "DES-II inclusion & licensing", "Not yet selected (advisor R22); commercial licensing unverified (R10)", "Omitted from beta until adopted + licensed"],
  ["A10", "AMBER", "State vs trait split on screener items", "Advisor R18", "Beta split per digest — confirm"],
];

// ---- data: deterministic rule register (B/C/D) ---------------------------
// [id, plain-language threshold to ratify]
const RULES_GATING = [
  ["FIT_UNDER_18", "Under 18 → not eligible (adults 18+ only)."],
  ["FIT_SELFHARM_30D", "Recent self-harm (30 d) → crisis routing, human support first."],
  ["FIT_UNSAFE_SITUATION", "Current situation not safe → crisis routing."],
  ["FIT_PSYCHOTIC_DISSOCIATIVE_DX", "Psychotic/dissociative dx → standing restriction (reversible only by support contact)."],
  ["FIT_HOSPITALIZATION_12M", "Psychiatric hospitalization in 12 mo → standing restriction (ledger A6)."],
  ["FIT_SUBSTANCE_DEPENDENCE", "Substance dependence → standing restriction."],
  ["FIT_SEIZURE_PHOTOSENSITIVE", "Seizure / photosensitivity → visual movement disabled for the account."],
  ["FIT_ACUTE_MEDICAL", "Acute medical concern → gentle pacing + extra resources."],
  ["ACUTE_TRAUMA_30D", "Trauma within 30 d → grounding/orientation only, no BLS (Vol I A-8)."],
  ["DAILY_HARM_URGE", "Daily check-in flags harm urge → crisis routing."],
  ["DAILY_NOT_SAFE", "Daily: cannot keep self safe → crisis routing."],
  ["CRISIS_PHQ9_ITEM9", "PHQ-9 item 9 ≥ 1 (ANY nonzero) → 72 h stabilization + one binary safety question."],
  ["CRISIS_PCL5_ITEM16", "PCL-5 item 16 ≥ 3 → 72 h stabilization + safety question."],
  ["DAILY_DISSOCIATION_7", "Daily dissociation ≥ 7 → grounding only."],
  ["DAILY_ACTIVATION_8", "Daily activation ≥ 8 → grounding only."],
  ["DAILY_SHUTDOWN_8", "Daily shutdown ≥ 8 → grounding only."],
  ["DAILY_INTOXICATION", "Intoxication reported → activating work rests, grounding open."],
  ["DAILY_DISSOCIATION_4", "Daily dissociation 4–6 → stabilization (activating work waits)."],
  ["DAILY_SLEEP_LOW", "Sleep ≤ 2 → stabilization."],
  ["DAILY_SUBSTANCE", "Substance use reported → lower intensity, stabilization open."],
  ["MISSING_CHECKIN", "No check-in today → grounding only until completed (missing input never favorable)."],
  ["DES2_HIGH", "DES-II ≥ 30 → grounding-first + imagery restriction + clinician referral."],
  ["DES2_CAUTION", "DES-II 20–29.99 → gentle, state-dependent imagery (silent caution)."],
  ["PCL5_WEEKLY_RISE_10", "PCL-5 week-over-week rise ≥ 10 → 14-day cautious ceiling + support."],
  ["ITQ_COMBINED_RISE_8", "ITQ (PTSD+DSO) weekly rise ≥ 8 → 14-day cautious ceiling + support."],
  ["READY_RISK_FLAG", "Any active safety flag → route to support before anything else."],
  ["READY_LESS_THAN_SAFE", "Less-than-fully-safe → readiness capped at stabilization band (ceiling 30)."],
  ["READY_PAUSE_CAPACITY_LOW", "Low pause-capacity → cautious band (ceiling 60); build pause skill first."],
  ["REENTRY_PENDING", "Return after a rest → fresh check-in + grounding, access opens gradually."],
];
const RULES_SESSION = [
  ["SESSION_START_SUDS_CEILING", "Deny stimulation if starting SUDS > 5."],
  ["SESSION_MAX_SETS", "At most 2 stimulation sets per session (beta)."],
  ["SESSION_CONTAINMENT_DELTA", "Containment if post-set SUDS rises by ≥ 2."],
  ["SESSION_CONTAINMENT_ABSOLUTE", "Containment if post-set SUDS reaches ≥ 8."],
  ["SESSION_HARD_STOP_SUDS", "Hard-stop containment if SUDS reaches ≥ 9."],
  ["SESSION_RISE_OVER_START", "Containment if SUDS rises ≥ 3 over the starting value."],
  ["SESSION_TWO_RISES", "Containment after two consecutive +1 rises."],
  ["SESSION_NO_CHANGE", "Close (no more sets) if SUDS unchanged across 2 sets (“stuck is a stop signal”)."],
  ["SESSION_DISSOCIATION_STOP", "Stop the exercise if in-session dissociation reaches ≥ 4."],
  ["SESSION_ORIENTATION_STOP", "Stop + re-orient if the member is not oriented to the present."],
  ["SESSION_WIND_DOWN", "Wind-down (no new sets) at 30 minutes."],
  ["SESSION_HARD_STOP_TIME", "Force closure at 40 minutes."],
  ["SESSION_CLOSURE_MIN", "Mandatory closure ≥ 120 s regardless of score."],
  ["SESSION_GROUND_ME", "Ground-Me: one-tap halt, locks stimulation for the session, no return."],
  ["BLS_HZ", "Bilateral stimulation 1.0–1.5 Hz (default 1.25); no adaptive speed, no mid-set increase."],
  ["BLS_NO_VISUAL_BETA", "No visual BLS in beta (auditory + self-tapping only)."],
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
  ["LIVE_SESSION_CRISIS_SCRIPTED", "Crisis checked first; crisis / high-activation replies scripted → Ground-me + 988, never AI."],
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
  const W = [1900, 4560, 2900]; // id, threshold, verdict  == 9360
  const trs = [headRow(["Rule ID", "Threshold / behavior to ratify", "Verdict (mark one)"], W)];
  rows.forEach((r, i) => {
    const fill = i % 2 ? ZEBRA : undefined;
    trs.push(new TableRow({
      children: [
        cell([p(txt(r[0], { bold: true, size: 16 }), { after: 0 })], { w: W[0], fill }),
        cell([p(txt(r[1], { size: 18 }), { after: 0 })], { w: W[1], fill }),
        cell([p(verdictRuns(), { after: 0 })], { w: W[2], fill }),
      ],
    }));
  });
  return table(W, trs);
}

// Section A table
function sectionATable() {
  const W = [640, 2100, 3160, 3460]; // #, param, conflict, ruling == 9360
  const trs = [headRow(["#", "Parameter", "Conflict / beta value", "Authoritative ruling (write value + rationale)"], W)];
  SECTION_A.forEach((r) => {
    const sev = r[1] === "RED" ? REDBG : AMBERBG;
    trs.push(new TableRow({
      children: [
        cell([p(txt(r[0], { bold: true, size: 16 }), { after: 0 })], { w: W[0], fill: sev }),
        cell([p(txt(r[2], { bold: true, size: 17 }), { after: 0 })], { w: W[1] }),
        cell([
          p(txt("Conflict: ", { bold: true, size: 15, color: MUTE }), { after: 0 }),
          p(txt(r[3], { size: 16 }), { after: 40 }),
          p([txt("Beta uses: ", { bold: true, size: 15, color: MUTE }), txt(r[4], { size: 16 })], { after: 0 }),
        ], { w: W[2] }),
        cell([p(txt(" ", { size: 16 }), { after: 0 })], { w: W[3], fill: FILLBLANK }),
      ],
    }));
  });
  return table(W, trs);
}

// Reviewer credential block
function reviewerBlock(n) {
  const W = [2600, 6760];
  const row = (label) => new TableRow({
    children: [
      cell([p(txt(label, { bold: true, size: 18, color: MUTE }), { after: 0 })], { w: W[0], fill: ZEBRA, valign: "center" }),
      cell([p(txt(" ", { size: 18 }), { after: 0 })], { w: W[1] }),
    ],
  });
  return table(W, [
    new TableRow({ children: [cell([p(txt(`Reviewer ${n}`, { bold: true, color: HEADFG, size: 20 }), { after: 0 })], { w: W[0] + W[1], span: 2, fill: HEADBG })] }),
    row("Full name"),
    row("Professional title"),
    row("License type & number"),
    row("Jurisdiction / state"),
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
  txt("Review session / ref: ", { bold: true, size: 20 }), txt("__________________", { size: 20 })], { after: 160 }));

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
children.push(reviewerBlock(1));
children.push(p(txt(" ", { size: 8 })));
children.push(reviewerBlock(2));

// ---------- Part 2 ----------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 2 — Numeric conflict resolution (ledger Section A)", HeadingLevel.HEADING_1));
children.push(p(txt("The specification's main body, Appendix A, and advisor worksheet give different numbers for the parameters below. Beta uses the safest value. Record the authoritative ruling and rationale for each; the four 🔴 items block real-member use until resolved. A7 and A8 are explicit placeholders that “nothing ships without.”", { size: 18, color: MUTE, italics: true })));
children.push(sectionATable());

// ---------- Part 3 ----------
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("Part 3 — Deterministic rule ratification (ledger Sections B–D)", HeadingLevel.HEADING_1));
children.push(p(txt("Confirm each immutable rule's threshold/behavior is clinically correct. Mark Agree or Needs-change; use the notes area at the end of each group for any required change. Rule IDs match the console register and CSV export at the config version above.", { size: 18, color: MUTE, italics: true })));

children.push(h("3.1  Access & gating rules (program-fit, daily routing, instruments, readiness)", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_GATING));
children.push(p([txt("Group notes / required changes: ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
children.push(p(txt("_".repeat(96), { color: RULE })));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("3.2  In-session runtime & bilateral-stimulation rules", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_SESSION));
children.push(p([txt("Group notes / required changes: ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
children.push(p(txt("_".repeat(96), { color: RULE })));

children.push(h("3.3  Voice input & live spoken-session guardrails", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_EXPERIENCE));
children.push(p([txt("Group notes / required changes: ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
children.push(p(txt("_".repeat(96), { color: RULE })));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(h("3.4  Therapy knowledge-base retrieval guardrails", HeadingLevel.HEADING_2));
children.push(ruleTable(RULES_KB));
children.push(p([txt("Group notes / required changes: ", { bold: true, size: 18, color: MUTE }), txt("_".repeat(70), { color: RULE })], { before: 80 }));
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
