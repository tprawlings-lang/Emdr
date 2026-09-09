import { MemberPage } from "@/components/member/MemberPage";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getSafetyPlan } from "@/lib/profile";
import { memberShellEnabled } from "@/lib/experience/flags";
import { activityShell } from "@/lib/experience/activity-shell";
import { ActivityShell } from "@/components/experience/ActivityShell";

// Always-available grounding page: no login gate on the basics, personalized
// with the member's own safety plan when signed in. "Ground now" is one of
// the controls the member must always have (feature spec section 18).
export default async function GroundPage() {
  const user = await getCurrentUser();
  const plan = user ? await getSafetyPlan(user.id) : null;
  const tools: string[] = plan ? JSON.parse(plan.grounding_tools_json) : [];

  const steps = [
    "Feel your feet on the floor. Press them down gently.",
    "Look around and name five things you can see.",
    "Name four things you can hear, three you can touch.",
    "Breathe out slowly, longer than you breathe in. Five times.",
    "Notice the temperature of the air on your skin.",
  ];

  // Package 3's active-session shell (handoff 09 §1.6, §4.3).
  //
  // GROUNDING IS AN ACTIVITY, and until now it rendered inside the ordinary
  // member chrome — with Today, Tools and Progress across the top of a screen
  // somebody opened because they were activated. §1.6: "Routine navigation is
  // removed during an activity and returns after a safe exit." The shell below
  // imports no navigation manifest at all, so there is nothing here to
  // accidentally leave through.
  //
  // AND PAUSE DOES NOT CLAIM TO SAVE ANYTHING. `commitsProgress` is left false
  // because this page holds no server state, so Pause says "nothing is recorded
  // either way" instead of "keeps your place". §4.5: a claim on a member
  // surface has to be true at the moment it is read, and the version of this
  // sentence that sounds more reassuring is the one that is false.
  //
  // THE FLAG DOES NOT GATE GROUNDING ITSELF. Both branches render the same five
  // steps, the same safety-plan reminder and the same two exits — §1's rule
  // that "grounding and crisis resources remain reachable even when a write,
  // subscription, sync, or service fails" would be broken by a grounding page
  // that depended on a feature flag to render.
  if (memberShellEnabled()) {
    return (
      <ActivityShell
        view={activityShell({
          activityId: "ground",
          title: "Come back to the room",
          step: { index: 1, total: steps.length, instruction: "No rush. One step at a time." },
        })}
        pauseHref={user?.role === "member" ? "/app/today" : "/"}
        stopHref={user?.role === "member" ? "/app/today" : "/"}
      >
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li
              key={i}
              className="rounded-3xl border border-ground/10 bg-linen p-5 text-lg leading-relaxed shadow-soft"
            >
              {s}
            </li>
          ))}
        </ol>

        {plan?.reminder_phrase && (
          <div className="mt-8 rounded-3xl bg-moss p-6 text-center">
            <p className="text-sm text-olive">You asked Steady to remind you:</p>
            <p className="mt-2 type-display text-2xl font-medium">&ldquo;{plan.reminder_phrase}&rdquo;</p>
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
      </ActivityShell>
    );
  }

  return (
    <MemberPage
        layer="actions"
        title="Come back to the room"
        lede="No rush. One step at a time."
      >

      <ol className="mt-8 space-y-4">
        {steps.map((s, i) => (
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
            href="/app/today"
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
    </MemberPage>
  );
}
