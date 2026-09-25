import type { TenantConfig } from "./types";
import type { EvaluationSeedPlan } from "./evaluation-seed";

// evolvedMD's evaluation tenant (Handoff 11 §2), as the handoff gives it.
// Values marked "evolvedMD supplies" stay null until they do; the questions
// that set them are Handoff 11 §6, on the review worksheet.
export const EVOLVEDMD_TENANT: TenantConfig = {
  id: "evolvedmd-eval",
  mode: "evaluation",
  displayName: "evolvedMD",
  // The handoff names "evolvedmd.svg"; the file is evolvedMD's to supply and
  // is not in the repository, so the name is shown in text until it is.
  coBrand: { partnerLogo: null, poweredBy: "Steady" },
  states: ["AZ", "MA", "NH", "ME"],
  sites: ["North Clinic", "Valley Clinic", "Harbor Virtual Care"],
  measures: {
    phq9: { cadenceDays: 14, beforeVisit: true },
    gad7: { cadenceDays: 14, beforeVisit: true },
  },
  treatToTarget: {
    responseReductionPct: 50,
    remissionPhq9Below: 5,
    reviewIfNotRespondingByWeek: 10,
  },
  escalation: {
    memberCrisisCopy: "988 plus care team contact",
    careTeamContact: { phone: null, hours: null },
    alertSlaHours: 24,
  },
  assignableCatalog: "signed-plus-partner-slots",
};

// The synthetic caseload (Handoff 11 W1): 3 care managers carrying about 95
// each, 1 psychiatric consultant, 2 primary care providers, 1 leadership user,
// and one member tester per care manager. Mostly depression and anxiety, a
// minority with trauma presentations, most new to behavioral health care.
// Names are single words from an obviously synthetic list.
export const EVOLVEDMD_SEED_PLAN: EvaluationSeedPlan = {
  version: "evaluation-caseload-v1",
  weeks: 16,
  careManagers: [
    { name: "Alder", patients: 95 },
    { name: "Birch", patients: 93 },
    { name: "Cedar", patients: 92 },
  ],
  consultants: ["Dogwood"],
  primaryCare: ["Elm", "Fir"],
  leadership: ["Ginkgo"],
  memberTesters: 3,
  presentations: { depression: 0.5, anxiety: 0.35, trauma: 0.15 },
  trajectories: {
    early_responder: 0.24, slow_responder: 0.24, non_responder: 0.12, dropout: 0.08,
    measure_overdue: 0.07, engaged_flat: 0.06, disengaged_improving: 0.06, typical: 0.13,
  },
  newToCare: 0.8,
};
