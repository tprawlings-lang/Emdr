// Versioned policy identifiers. Bump the version whenever consent or notice
// text changes so the consent ledger stays meaningful.
export const CONSENT_VERSION = "v1.0-dev";

export const CONSENT_SECTIONS: { title: string; body: string }[] = [
  {
    title: "What this service is",
    body: "This is an EMDR-informed, clinician-supervised care program for adults with trauma-related symptoms. The app automates screening, skills practice, measurement, and pacing. A licensed specialist reviews your progress, decides when higher-intensity modules unlock, and manages safety concerns. This app is not a replacement for licensed trauma therapy and does not diagnose any condition.",
  },
  {
    title: "Clinician oversight model",
    body: "Oversight is asynchronous by default. Your specialist reviews your screening results, symptom trends, alerts, and unlock requests through a clinical dashboard, typically within defined response times rather than in real time. Diagnostic decisions, unlocking of trauma-processing modules, safety planning, referrals, and discharge are always made by the specialist, not by the software.",
  },
  {
    title: "Emergency limitations",
    body: "This service is NOT for emergencies and is not monitored in real time. If you are in immediate danger or thinking about harming yourself or someone else, call or text 988 (Suicide & Crisis Lifeline, US), call 911, or go to the nearest emergency room. The app will always show you these options when safety screens are positive.",
  },
  {
    title: "Privacy and your health information",
    body: "Your responses, scores, session records, and messages are health information. They are stored encrypted, are visible to your care team, and are never shared with advertisers or marketing tools. You may request a copy of your records or ask for your account and data to be deleted, subject to clinical record-retention requirements.",
  },
  {
    title: "Fees",
    body: "The core supervised program is offered as a monthly subscription. Payment details are handled by a payment processor and are kept separate from your clinical records. Escalation services such as live telehealth visits may carry separate fees, which will always be disclosed before you incur them.",
  },
  {
    title: "Tracking disclosure",
    body: "We do not use advertising trackers, analytics pixels, or session-replay tools anywhere health information may appear. We collect only the technical data needed to run the service securely (such as login events and security logs), and we log clinical and safety events for audit purposes.",
  },
  {
    title: "Your rights and choices",
    body: "You can stop any session at any time — stopping early is always allowed and never penalized. You can pause or end the program, request your records, and revoke this consent. Revoking consent stops new care activities but does not erase records we are required to keep.",
  },
];
