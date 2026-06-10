import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SteadyMark, Wordmark } from "@/components/Brand";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "member" ? "/dashboard" : "/clinician");

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <div className="rounded-3xl border border-pause/40 bg-pause-soft px-5 py-3.5 text-sm text-ground">
        <strong>Emergency use: No.</strong> This service is not monitored in real time. If you
        are in danger right now, call or text{" "}
        <a className="font-semibold underline" href="tel:988">988</a> or call 911.
      </div>

      <div className="mt-14 flex items-center gap-4 text-ground">
        <SteadyMark className="h-12 w-12 text-olive" />
        <Wordmark className="text-6xl" />
      </div>
      <h1 className="mt-6 font-serif text-4xl font-medium leading-tight sm:text-5xl">
        A steadier way through trauma.
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-olive">
        A private, specialist-informed space for guided EMDR-based support, daily check-ins,
        grounding tools, and structured reflection. Move slowly. Pause anytime. Stay in control.
      </p>

      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/login"
          className="rounded-full bg-sage px-8 py-3.5 font-medium text-ground transition-colors hover:bg-sage-deep"
        >
          Begin when you feel ready
        </Link>
        <Link
          href="/crisis"
          className="rounded-full border border-support/50 px-8 py-3.5 font-medium text-support transition-colors hover:bg-support/10"
        >
          I need grounding first
        </Link>
      </div>

      <div className="mt-16 space-y-4 leading-relaxed text-ground/90">
        <p>
          Steady is <strong>not</strong> a replacement for therapy and does not deliver
          autonomous treatment. It is care software: it handles screening with validated
          measures, daily readiness check-ins, stabilization and skills practice, and progress
          measurement — while a licensed specialist reviews your progress and decides when
          higher-intensity trauma-processing modules open.
        </p>
        <ul className="space-y-3">
          {[
            "Grounding and stabilization skills you can use right away.",
            "Every session moves through a daily safety check-in first.",
            "Trauma-processing modules open only after specialist review.",
            "Clear crisis pathways, no advertising trackers, full audit trail.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-3">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-sage" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-14 rounded-3xl border border-ground/10 bg-linen p-7 text-sm leading-relaxed text-olive shadow-soft">
        <h2 className="font-serif text-xl font-medium text-ground">Who this is for</h2>
        <p className="mt-2">
          Adults with trauma-related symptoms who pass screening, are not in acute crisis, and
          can work through structured material with remote specialist backup. It is not suitable
          for emergencies, for minors, or for people with active suicidal intent, psychosis, or
          uncontrolled dissociative crises — screening will route to appropriate help instead.
        </p>
      </div>

      <p className="mt-14 text-center font-serif text-2xl font-medium text-olive">
        Your nervous system deserves a steady place to land.
      </p>
    </main>
  );
}
