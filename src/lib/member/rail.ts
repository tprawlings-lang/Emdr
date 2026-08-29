// Where each information layer goes, for a member.
//
// §25's four layers (action, meaning, evidence, raw record) are the same for
// every role; what differs is the destination each one has. A member's
// "Actions" is their activities; a clinician's is their queue.
//
// Audit is deliberately absent for a member. §30.6's minimum-necessary rule
// and §26's member acceptance give them their own record through consent and
// care-team, not a governed event log — and the shell renders a layer with no
// destination as plain text rather than a link that goes nowhere.

import type { RailSlug } from "@/components/app/AppShell";

export const MEMBER_RAIL: Partial<Record<RailSlug, string>> = {
  overview: "/app/today",
  progress: "/app/progress",
  actions: "/app/activities",
  evidence: "/app/plan",
};
