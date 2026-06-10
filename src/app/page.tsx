import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "member" ? "/dashboard" : "/clinician");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Emergency use: No.</strong> This service is not monitored in real time. If you
        are in danger right now, call or text <a className="font-semibold underline" href="tel:988">988</a> or call 911.
      </div>

      <h1 className="mt-10 text-4xl font-bold tracking-tight">Steady</h1>
      <p className="mt-2 text-lg text-stone-600">
        EMDR-informed, clinician-supervised care support for adults living with the effects of
        trauma.
      </p>

      <div className="mt-8 space-y-4 text-stone-700">
        <p>
          Steady is <strong>not</strong> a replacement for therapy and does not deliver
          autonomous treatment. It is care software: it handles screening with validated
          measures, daily readiness check-ins, stabilization and skills practice, and progress
          measurement — while a licensed specialist reviews your progress and decides when
          higher-intensity trauma-processing modules unlock.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Stabilization and grounding skills you can use right away.</li>
          <li>Every session is gated by a daily safety check-in.</li>
          <li>Trauma-processing modules open only after specialist review.</li>
          <li>Clear crisis pathways, no advertising trackers, full audit trail.</li>
        </ul>
      </div>

      <div className="mt-10 flex gap-4">
        <Link
          href="/login"
          className="rounded-lg bg-stone-900 px-6 py-3 font-medium text-white hover:bg-stone-700"
        >
          Sign in
        </Link>
        <Link
          href="/crisis"
          className="rounded-lg border border-red-300 px-6 py-3 font-medium text-red-700 hover:bg-red-50"
        >
          I need help now
        </Link>
      </div>

      <div className="mt-12 rounded-lg border border-stone-200 bg-white p-5 text-sm text-stone-600">
        <h2 className="font-semibold text-stone-800">Who this is for</h2>
        <p className="mt-2">
          Adults with trauma-related symptoms who pass screening, are not in acute crisis, and
          can work through structured material with remote specialist backup. It is not suitable
          for emergencies, for minors, or for people with active suicidal intent, psychosis, or
          uncontrolled dissociative crises — screening will route to appropriate help instead.
        </p>
      </div>
    </main>
  );
}
