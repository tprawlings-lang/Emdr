import { requireIntelligence } from "@/lib/auth";

// Auth for every payer surface, enforced here so a new route cannot ship
// unauthenticated by forgetting a line. Navigation is the shell's rail.
export default async function PayerLayout({ children }: { children: React.ReactNode }) {
  await requireIntelligence();
  return <>{children}</>;
}
