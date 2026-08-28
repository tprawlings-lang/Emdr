import { MemberNav } from "@/components/member/MemberNav";
import { requireMember } from "@/lib/auth";
import { listPractices } from "@/lib/practices";
import MeditationLibrary, { type LibraryCopy } from "@/components/MeditationLibrary";

// Sleep wind-downs (roadmap F5). Backend-served guided scripts to do lying
// down; the client renders the same guided player with on-device narration.
// Deterministic scripts — no media pipeline.
const SLEEP_COPY: LibraryCopy = {
  heading: "Wind down for sleep",
  intro:
    "Guided wind-downs to do lying down, in the dark — slow breathing, melting into rest, putting the day down. Let them read aloud, dim your screen, and drift. It's completely fine to fall asleep before the end.",
  doneTitle: "Rest well",
  doneBody: "However far you got, you gave your body a chance to let go. Sleep will come.",
  anotherLabel: "A different wind-down",
  footnote:
    "Best done lying down with the lights low. Stop any time — and it's okay to fall asleep partway through.",
};

export default async function SleepPage() {
  const user = await requireMember();
  const practices = await listPractices(user.id, "sleep");
  return <MeditationLibrary practices={practices} voiceDefault={true} copy={SLEEP_COPY} />;
}
