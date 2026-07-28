import { getCurrentUser } from "@/lib/auth";
import { getSosPanel } from "@/lib/sos";
import SosButton from "./SosButton";

// Server wrapper that puts the panic button on every screen for a signed-in
// member, pre-loaded with their own calm place and safe-person contact so the
// panel opens instantly with no round-trip. Renders nothing for signed-out
// visitors, clinicians, or admins.
export default async function SosMount() {
  const user = await getCurrentUser();
  if (user?.role !== "member") return null;
  const panel = await getSosPanel(user.id);
  return <SosButton panel={panel} />;
}
