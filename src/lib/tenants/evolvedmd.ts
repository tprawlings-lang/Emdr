import type { TenantConfig } from "./types";

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
