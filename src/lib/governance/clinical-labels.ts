// Clinical labels that stay on clinician surfaces (Expansion Handoff
// non-negotiable 6: "Members see plain-language names. Instrument names,
// diagnostic terms, and scores stay on clinician surfaces").
//
// One list, read by the source guard (tests/member-boundary.test.ts) and by
// the rendered-page walk (tests/e2e/member-clinical-labels.spec.ts), so the
// two cannot disagree about what counts.
//
// Scores are guarded separately and more strictly — they must never reach the
// member renderer at all (member-boundary.test.ts). This list is about WORDS.
//
// NOT IN SCOPE, deliberately: the program-fit questions ask whether somebody
// has been diagnosed with a psychotic or dissociative disorder. That is a
// question, not a label applied to the member, and its wording is awaiting
// clinical sign-off (fitness-screener.ts). The validated questionnaires'
// items are also left as published — rewording an item changes the
// instrument. Neither contains a term below.
export const CLINICAL_LABEL =
  /\b(?:PC-PTSD-5|PCL-5|PHQ-9|GAD-7|ITQ|DES-II|C-?PTSD|PTSD|DSM(?:-5)?|ICD-1[01]|SUDS)\b/;
