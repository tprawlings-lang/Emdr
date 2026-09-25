// Programs over the mobile API (Handoff 10 §3.7). The same functions the web
// uses, so the phone gets the same rules; this only shapes the response.
//
// MEMBER-SAFE SHAPE: no sign-off rows, no outcome measure, no gate numbers —
// a unit's standing is a word, as on the web.

import type { ProgramView } from "../programs";

export function programJson(v: ProgramView) {
  return {
    id: v.program.id,
    title: v.program.title,
    blurb: v.program.blurb,
    pendingClinicalReview: v.visibility === "draft",
    enrollment: v.enrollment,
    finished: v.finished,
    next: v.next?.id ?? null,
    units: v.units.map((u) => ({
      id: u.unit.id,
      title: u.unit.title,
      purpose: u.unit.purpose,
      state: u.state,
      activity: u.unit.activity,
      text: u.unit.text ?? [],
      lessonId: u.unit.lessonId ?? null,
      practiceIds: u.unit.practiceIds,
      copy: u.unit.copy ?? null,
    })),
  };
}
