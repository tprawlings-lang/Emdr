import { requireMember } from "@/lib/auth";
import { listPractices } from "@/lib/practices";
import MeditationLibrary, { type LibraryCopy } from "@/components/MeditationLibrary";

// Gentle movement (roadmap F1). Backend-served guided movement scripts; the
// client renders the same guided player with on-device narration (handy when
// your hands are busy moving). Deterministic scripts — the form-free subset,
// so no video pipeline.
const MOVE_COPY: LibraryCopy = {
  heading: "Move",
  intro:
    "Gentle, guided movement to help held stress leave the body — orienting turns, rooting down, easy stretches, shaking it off. Move only as far as feels good; most works seated too. Read aloud so you can keep your hands free.",
  doneTitle: "Nicely moved",
  doneBody: "You gave your body a way to release and reset. Notice how you feel now, compared to when you started.",
  anotherLabel: "Another movement",
  footnote:
    "Gentler, orienting movements come first on days your check-in suggests taking it easy. Move within comfort, and stop any time.",
};

export default async function MovePage() {
  const user = await requireMember();
  const practices = await listPractices(user.id, "movement");
  return <MeditationLibrary practices={practices} voiceDefault={true} copy={MOVE_COPY} />;
}
