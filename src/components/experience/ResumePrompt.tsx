import type { ResumeOffer } from "@/lib/experience/activity-shell";

// The resume offer (handoff 09 §4.4; Package 3).
//
// §4.4: "On reconnect, check current server state before offering resume. A
// prior answer or permission may no longer be valid."
//
// THIS COMPONENT CANNOT MAKE THE OFFER ON ITS OWN. It renders a `ResumeOffer`,
// and the only function that produces one takes the server's answer as a
// required argument. So there is no path from "the browser remembers a session"
// to "pick up where you left off" that does not pass through a server read —
// which matters because the thing that may have changed while somebody was away
// is not only whether their answers landed. It is whether today's gate still
// lets them do it.
//
// AND `ask_server` RENDERS NOTHING. It is not a screen state; it is the surface
// admitting it has not checked yet. Drawing a spinner for it would be drawing a
// promise that something is coming.

export function ResumePrompt({ offer }: { offer: ResumeOffer }) {
  if (offer.decision === "no_activity" || offer.decision === "ask_server") return null;

  const resuming = offer.decision === "resume";

  return (
    <section
      className={`mb-6 rounded-3xl border p-5 ${
        resuming ? "border-sage/50 bg-sage/10" : "border-ground/15 bg-linen"
      }`}
    >
      <p className="font-medium text-ground">{offer.label}</p>
      <p className="measure mt-1 text-sm leading-relaxed text-ground/90">{offer.note}</p>
    </section>
  );
}
