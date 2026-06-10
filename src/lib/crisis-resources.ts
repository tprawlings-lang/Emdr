// Region-aware crisis resources (compliance packet 4C). This file has an
// owner and a quarterly review task: numbers change, services sunset.
// Every entry carries a last-verified date; update it when re-verified.
// OWNER: founder (until a safety owner is named). NEXT REVIEW DUE: 2026-09-01.

export interface CrisisResource {
  label: string;
  /** tel: / sms: links render as tap-to-call / tap-to-text on mobile. */
  href: string;
  detail?: string;
}

export interface CrisisRegion {
  code: string;
  name: string;
  resources: CrisisResource[];
  emergencyLine: string;
  lastVerified: string;
}

export const CRISIS_REGIONS: CrisisRegion[] = [
  {
    code: "US",
    name: "United States",
    emergencyLine: "In immediate danger? Call 911",
    lastVerified: "2026-06-10",
    resources: [
      { label: "Call 988 — Suicide & Crisis Lifeline", href: "tel:988" },
      { label: "Text 988", href: "sms:988" },
      {
        label: "Crisis Text Line — text HOME to 741741",
        href: "sms:741741?&body=HOME",
      },
    ],
  },
  {
    code: "UK",
    name: "United Kingdom",
    emergencyLine: "In immediate danger? Call 999",
    lastVerified: "2026-06-10",
    resources: [{ label: "Samaritans — call 116 123 (free, 24/7)", href: "tel:116123" }],
  },
  {
    code: "CA",
    name: "Canada",
    emergencyLine: "In immediate danger? Call 911",
    lastVerified: "2026-06-10",
    resources: [
      { label: "Call or text 988 — Suicide Crisis Helpline", href: "tel:988" },
    ],
  },
  {
    code: "AU",
    name: "Australia",
    emergencyLine: "In immediate danger? Call 000",
    lastVerified: "2026-06-10",
    resources: [{ label: "Lifeline — call 13 11 14 (24/7)", href: "tel:131114" }],
  },
];

export const FALLBACK_RESOURCE: CrisisResource = {
  label: "Anywhere else: find a helpline in your country",
  href: "https://findahelpline.com",
  detail: "findahelpline.com lists free, confidential support lines worldwide — or call your local emergency number.",
};

/** Honesty rule (4C.4): shown wherever crisis resources appear. */
export const NOT_MONITORED_LINE =
  "Steady is not monitored in real time — no one from Steady will see this or respond. Please use the resources above to reach a real person now.";
