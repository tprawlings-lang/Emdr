import { MemberNav } from "@/components/member/MemberNav";
import { requireMember } from "@/lib/auth";
import { listPractices } from "@/lib/practices";
import MeditationLibrary from "@/components/MeditationLibrary";

// Meditation library (roadmap F2). Backend-served, safety-ordered for today's
// check-in; the client renders the guided player with on-device narration.
// Deterministic scripts — no media pipeline.
export default async function MeditatePage() {
  const user = await requireMember();
  const practices = await listPractices(user.id, "meditation");
  return <MeditationLibrary practices={practices} voiceDefault={true} />;
}
