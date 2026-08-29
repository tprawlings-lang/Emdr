import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { checkModuleAccess, voiceAvailableFor, liveAvailableFor } from "@/lib/gating";
import { getSavedCalmPlace, getSessionFocus } from "@/lib/session-focus";
import { hasSeizureFlag } from "@/lib/fitness-screener";
import { BETA_CONFIG } from "@/lib/safety/config";
import { getCompanionPrefs } from "@/lib/profile";
import { listPractices } from "@/lib/practices";
import { lessonsForModule } from "@/lib/lessons";
import SessionPlayer from "@/components/SessionPlayer";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = await params;
  const user = await requireMember();
  const mod = getModule(moduleId);
  if (!mod) redirect("/app/today");

  // Server-side gate: the session player never renders for a module the
  // member is not cleared for today.
  const access = await checkModuleAccess(user.id, mod);
  if (!access.allowed) {
    redirect(access.action === "crisis" ? "/crisis" : "/app/today");
  }

  // Offer everything Steady already knows — triggers, calm place, resources,
  // focus areas from companion conversations — as the session's focus.
  const preferredName =
    (await getCompanionPrefs(user.id))?.preferred_user_name?.trim() ||
    user.name?.trim().split(/\s+/)[0] ||
    null;
  const [focus, calmPlace, audioOnlyDefault, voiceEnabled, liveEnabled, breaths] = await Promise.all([
    getSessionFocus(user.id, mod.id),
    getSavedCalmPlace(user.id),
    hasSeizureFlag(user.id),
    voiceAvailableFor(user.id),
    liveAvailableFor(user.id),
    listPractices(user.id, "breathwork"),
  ]);

  // Whether the moving dot may be offered at all.
  //
  // The underlying defect the visual-BLS finding exposed was not which way the
  // flag was set — it was that the session never read it. The config said
  // visual BLS was disabled and the session offered it as the default anyway,
  // because nothing connected the two. Flipping the flag without wiring it
  // would leave the next person who flips it back with the same bug.
  //
  // Two independent conditions, and BOTH must hold. The config is a product
  // decision; the seizure flag is this member's own screening answer, and it
  // wins regardless of what the config permits.
  const visualAllowed = BETA_CONFIG.visualStimulationEnabled && !audioOnlyDefault;
  return (
    <SessionPlayer
      module={mod}
      focus={focus}
      calmPlace={calmPlace}
      audioOnlyDefault={audioOnlyDefault}
      visualAllowed={visualAllowed}
      voiceEnabled={voiceEnabled}
      memberName={preferredName}
      liveEnabled={liveEnabled}
      preparePractice={breaths[0] ?? null}
      relatedLessons={lessonsForModule(mod.id).map((l) => ({ id: l.id, title: l.title }))}
    />
  );
}
