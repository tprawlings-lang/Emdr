import { MemberNav } from "@/components/member/MemberNav";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getSafetyPlan } from "@/lib/profile";

// Always-available grounding page: no login gate on the basics, personalized
// with the member's own safety plan when signed in. "Ground now" is one of
// the controls the member must always have (feature spec section 18).
export default async function GroundPage() {
  const user = await getCurrentUser();
  const plan = user ? await getSafetyPlan(user.id) : null;
  const tools: string[] = plan ? JSON.parse(plan.grounding_tools_json) : [];

  return (
    <>
      <MemberNav />
      <main className="mx-auto max-w-xl px-6 py-14">
      <h1 className="type-display text-4xl font-medium">Come back to the room</h1>
      <p className="mt-3 text-lg text-olive">No rush. One step at a time.</p>

      <ol className="mt-8 space-y-4">
        {[
          "Feel your feet on the floor. Press them down gently.",
          "Look around and name five things you can see.",
          "Name four things you can hear, three you can touch.",
          "Breathe out slowly, longer than you breathe in. Five times.",
          "Notice the temperature of the air on your skin.",
        ].map((s, i) => (
          <li key={i} className="rounded-3xl border border-ground/10 bg-linen p-5 text-lg leading-relaxed shadow-soft">
            {s}
          </li>
        ))}
      </ol>

      {plan?.reminder_phrase && (
        <div className="mt-8 rounded-3xl bg-moss p-6 text-center">
          <p className="text-sm text-olive">You asked Steady to remind you:</p>
          <p className="mt-2 type-display text-2xl font-medium">“{plan.reminder_phrase}”</p>
        </div>
      )}

      {tools.length > 0 && (
        <div className="mt-6 rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
          <h2 className="font-semibold">From your safety plan</h2>
          <p className="mt-1 text-sm text-olive">These have helped you before:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {tools.map((t) => (
              <span key={t} className="rounded-full bg-sage/30 px-4 py-1.5 text-sm">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10 flex flex-col gap-3">
        {user?.role === "member" && (
          <Link
            href="/dashboard"
            className="rounded-full bg-sage px-6 py-3 text-center font-medium text-ground transition-colors hover:bg-sage-deep"
          >
            I feel more settled
          </Link>
        )}
        <Link
          href="/crisis"
          className="rounded-full border border-ground/30 px-6 py-3 text-center font-medium text-ground transition-colors hover:bg-ground/10"
        >
          I need more help than this
        </Link>
      </div>
    </main>
    </>
  );
}
