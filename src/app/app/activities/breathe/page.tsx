import { requireMember } from "@/lib/auth";
import { listPractices } from "@/lib/practices";
import BreatheLibrary from "@/components/BreatheLibrary";

// Breathwork library (roadmap F3). Backend-served, safety-ordered for today's
// check-in; the client renders the pacer. Deterministic patterns — no media.
export default async function BreathePage() {
  const user = await requireMember();
  const practices = await listPractices(user.id, "breathwork");
  return <BreatheLibrary practices={practices} />;
}
