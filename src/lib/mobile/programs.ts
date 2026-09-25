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
    // The entry screen's words, and where the member stands on it. Its answers
    // go with POST …/enroll as `entryAnswers`, one boolean per question.
    entryScreen: v.program.entryScreen
      ? {
          id: v.program.entryScreen.id,
          intro: v.program.entryScreen.intro,
          questions: v.program.entryScreen.questions,
          yes: v.program.entryScreen.yes,
          no: v.program.entryScreen.no,
          answered: v.entry?.answered ?? false,
          /** What to say while a part is left out; empty otherwise. */
          lines: v.entry?.answered ? v.entry.lines : [],
        }
      : null,
    finished: v.finished,
    next: v.next?.id ?? null,
    units: v.units.map((u) => ({
      id: u.unit.id,
      title: u.unit.title,
      purpose: u.unit.purpose,
      state: u.state,
      activity: u.unit.activity,
      text: u.unit.text ?? [],
      list: u.unit.list ?? [],
      textAfter: u.unit.textAfter ?? [],
      lessonId: u.unit.lessonId ?? null,
      practiceIds: u.unit.practiceIds,
      copy: u.unit.copy ?? null,
    })),
  };
}
