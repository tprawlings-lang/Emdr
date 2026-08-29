import { redirect } from "next/navigation";

// §26 names /organization/overview as this role's home. A redirect rather than
// a duplicate screen, because /organization is the address people type.
export default function OrganizationHome() {
  redirect("/organization/overview");
}
