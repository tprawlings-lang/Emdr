import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getModule } from "@/lib/modules";
import { checkModuleAccess } from "@/lib/gating";
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

  return <SessionPlayer module={mod} />;
}
