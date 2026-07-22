import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { checkModuleAccess } from "@/lib/gating";
import { getSavedCalmPlace, getSessionFocus } from "@/lib/session-focus";
import { hasSeizureFlag } from "@/lib/fitness-screener";
import { voiceInputEnabled } from "@/lib/safety/config";
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
  const access = checkModuleAccess(user.id, mod);
  if (!access.allowed) {
    redirect(access.action === "crisis" ? "/crisis" : "/dashboard");
  }

  // Offer everything Steady already knows — triggers, calm place, resources,
  // focus areas from companion conversations — as the session's focus.
  return (
    <SessionPlayer
      module={mod}
      focus={getSessionFocus(user.id, mod.id)}
      calmPlace={getSavedCalmPlace(user.id)}
      audioOnlyDefault={hasSeizureFlag(user.id)}
      voiceEnabled={voiceInputEnabled()}
    />
  );
}
