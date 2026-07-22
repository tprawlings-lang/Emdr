import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { checkModuleAccess, voiceAvailableFor, liveAvailableFor } from "@/lib/gating";
import { getSavedCalmPlace, getSessionFocus } from "@/lib/session-focus";
import { hasSeizureFlag } from "@/lib/fitness-screener";
import { getCompanionPrefs } from "@/lib/profile";
import SessionPlayer from "@/components/SessionPlayer";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ moduleId: string }>;
}) {
  const { moduleId } = await params;
  const user = await requireMember();
  const mod = getModule(moduleId);
  if (!mod) redirect("/dashboard");

  // Server-side gate: the session player never renders for a module the
  // member is not cleared for today.
  const access = await checkModuleAccess(user.id, mod);
  if (!access.allowed) {
    redirect(access.action === "crisis" ? "/crisis" : "/dashboard");
  }

  // Offer everything Steady already knows — triggers, calm place, resources,
  // focus areas from companion conversations — as the session's focus.
  const preferredName =
    (await getCompanionPrefs(user.id))?.preferred_user_name?.trim() ||
    user.name?.trim().split(/\s+/)[0] ||
    null;
  const [focus, calmPlace, audioOnlyDefault, voiceEnabled, liveEnabled] = await Promise.all([
    getSessionFocus(user.id, mod.id),
    getSavedCalmPlace(user.id),
    hasSeizureFlag(user.id),
    voiceAvailableFor(user.id),
    liveAvailableFor(user.id),
  ]);
  return (
    <SessionPlayer
      module={mod}
      focus={focus}
      calmPlace={calmPlace}
      audioOnlyDefault={audioOnlyDefault}
      voiceEnabled={voiceEnabled}
      memberName={preferredName}
      liveEnabled={liveEnabled}
    />
  );
}
