import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SteadyMark, Wordmark } from "@/components/Brand";

// Marketing landing page. The voice is "calm conviction": the benefit-led
// structure of direct-to-consumer EMDR marketing (outcomes, research,
// conditions, stories, guarantee) carried by Steady's slow, grounded visual
// language. Every claim about EMDR is about the method, not this product;
// member stories are illustrative and labeled as such.

const CONDITIONS = [
  { name: "PTSD & trauma", note: "Single events or long histories" },
  { name: "Anxiety & panic", note: "The alarm that won't switch off" },
  { name: "Grief & loss", note: "When it stays frozen in place" },
  { name: "Sleep & nightmares", note: "Nights that finally settle" },
  { name: "Shame & self-worth", note: "The old beliefs underneath" },
  { name: "Anger & overwhelm", note: "A shorter fuse than you want" },
];

const STEPS = [
  {
    title: "Check in",
    body: "90 seconds, once a day. Steady reads how activated, rested, and present you are — and recommends what's actually safe to do today.",
  },
  {
    title: "Ground",
    body: "Your calm place, your tools, your companion. Settle your nervous system before anything else is asked of it.",
  },
  {
    title: "Process",
    body: "Guided eye-movement sessions with a chosen focus, short sets, and distress ratings between every one. You are in control the whole way.",
  },
  {
    title: "Reflect",
    body: "Watch your distress scores drop across sessions. Your companion remembers what helped and builds on it.",
  },
];

const STORIES = [
  {
    quote:
      "I rated the memory an 8 when we started. Forty minutes later it was a 3, and it's stayed there. I didn't have to tell anyone the whole story to get there.",
    name: "Maya",
    detail: "8 → 3 distress in one session",
  },
  {
    quote:
      "The check-in stopped me from pushing on a bad day, and honestly that's when I started trusting it. It paces you the way a good therapist would.",
    name: "Daniel",
    detail: "12 weeks in",
  },
  {
    quote:
      "My companion remembered my calm place, my triggers, what helps at 2am. I stopped having to start from zero every time.",
    name: "Ana",
    detail: "Sleeping through the night again",
  },
];

const FAQS = [
  {
    q: "Is self-guided EMDR safe?",
    a: "Steady is built so the safe path is the default. Every session starts with a daily readiness check-in, distress is rated between every set, and a session that climbs too high ends itself and walks you through grounding. Higher-intensity trauma-processing modules only open after a licensed specialist reviews your progress. And screening routes anyone in acute crisis to appropriate human help instead.",
  },
  {
    q: "Do I need any experience with EMDR?",
    a: "No. Steady starts with stabilization — a calm place, containment, grounding skills — and only moves toward processing when your readiness scores support it. Most members spend their first weeks building skills, not touching difficult memories.",
  },
  {
    q: "What if I get overwhelmed mid-session?",
    a: "You can stop at any moment, and stopping early is always allowed. If your distress rating climbs past the safety cap, the session ends itself, offers grounding one step at a time, and notifies your care team. That's the system working, not you failing.",
  },
  {
    q: "Is this a replacement for therapy?",
    a: "No — and we won't pretend otherwise. Steady is structured care software: validated screening, daily readiness checks, guided stabilization and processing modules, and progress measurement, with a licensed specialist reviewing your trajectory. Many members use it alongside a therapist; it never replaces emergency care.",
  },
  {
    q: "What does it cost?",
    a: "$24.99 a month after a 7-day free trial — a fraction of a single traditional session. If it doesn't feel right within your first week, cancel and pay nothing. Crisis support and grounding tools stay open to everyone, regardless of membership.",
  },
];

function Cta({ label = "Start your free week" }: { label?: string }) {
  return (
    <Link
      href="/signup"
      className="inline-block rounded-full bg-sage px-8 py-3.5 font-medium text-ground shadow-soft transition-colors hover:bg-sage-deep"
    >
      {label}
    </Link>
  );
}

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "member" ? "/dashboard" : "/clinician");

  return (
    <main className="overflow-x-clip">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 pt-8">
        <div className="flex items-center gap-3">
          <SteadyMark className="h-9 w-9 text-olive" />
          <Wordmark className="text-3xl" />
        </div>
        <div className="flex items-center gap-5 text-sm">
          <Link href="/crisis" className="font-semibold text-support underline">
            Need help now?
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-ground/20 px-5 py-2 text-ground/80 transition-colors hover:bg-moss"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 sm:grid-cols-[3fr_2fr]">
          <div>
            <p className="text-sm font-semibold tracking-wide text-olive uppercase">
              Guided EMDR-based care, at home
            </p>
            <h1 className="mt-4 font-serif text-5xl leading-[1.05] font-medium sm:text-6xl">
              Work through trauma,
              <br />
              <span className="text-olive">starting today, at your pace.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ground/85">
              EMDR doesn&apos;t just talk about what happened — it helps your brain finish
              processing it. Steady brings that method home: guided eye-movement sessions,
              a companion that remembers what helps you, and safety rails a clinician would
              recognize.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Cta label="Start your free week" />
              <Link
                href="/crisis"
                className="rounded-full border border-support/50 px-7 py-3.5 font-medium text-support transition-colors hover:bg-support/10"
              >
                I need grounding first
              </Link>
            </div>
            <p className="mt-5 text-sm text-olive">
              7 days free · cancel anytime · no equipment needed — just a quiet moment
            </p>
          </div>

          {/* Breathing visual: motion paced like a long exhale */}
          <div className="relative mx-auto hidden h-72 w-72 sm:block" aria-hidden="true">
            <div className="animate-breathe-slow absolute inset-0 rounded-full bg-moss" />
            <div className="animate-breathe absolute inset-8 rounded-full bg-sage/50" />
            <div className="absolute inset-16 rounded-full bg-linen shadow-soft" />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-ground">
              <SteadyMark className="h-14 w-14 text-olive" />
              <p className="mt-2 font-serif text-lg text-olive">breathe out longer</p>
            </div>
          </div>
        </div>

        {/* Emergency honesty, kept visible but quiet */}
        <div className="mt-12 rounded-3xl border border-pause/40 bg-pause-soft px-5 py-3.5 text-sm text-ground">
          <strong>Not for emergencies.</strong> Steady is not monitored in real time. If you are
          in danger right now, call or text{" "}
          <a className="font-semibold underline" href="tel:988">
            988
          </a>{" "}
          or call 911.
        </div>
      </section>

      {/* Research stats band — RCT/meta-analysis claims only, per research
          handoff: numbers-first cards, guideline endorsements in the subhead
          (never "recommended by the APA"), citations on every card. */}
      <section className="mx-auto max-w-5xl px-6 pt-20">
        <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
          Backed by randomized trials, not testimonials
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-olive">
          EMDR is recommended as a frontline PTSD treatment in clinical guidelines from the
          World Health Organization, the UK&apos;s NICE, and the U.S. Department of Veterans
          Affairs.
        </p>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {[
            {
              stat: "26 trials",
              text: "A meta-analysis of 26 randomized controlled trials spanning two decades found EMDR significantly reduced symptoms of PTSD, depression, and anxiety.",
              source: "Chen et al., PLOS ONE (2014)",
              href: "https://doi.org/10.1371/journal.pone.0103676",
            },
            {
              stat: "61%",
              text: "of participants in a randomized controlled trial no longer met PTSD criteria after just two EMDR sessions — versus 10% in the control group.",
              source: "Yurtsever et al., Frontiers in Psychology (2018)",
              href: "https://doi.org/10.3389/fpsyg.2018.00493",
            },
            {
              stat: "10 hospitals",
              text: "In a multisite randomized controlled trial across 10 hospitals, fully remote EMDR produced large reductions in PTSD, anxiety, and depression among frontline health workers.",
              source: "Jarero et al., multisite RCT (2020); see also Bongaerts et al., Eur J Psychotraumatology (2021)",
              href: "https://doi.org/10.1080/20008198.2020.1860346",
            },
          ].map((s) => (
            <div
              key={s.stat}
              className="flex flex-col rounded-3xl border border-ground/10 bg-linen p-7 text-center shadow-soft"
            >
              <p className="font-serif text-4xl font-medium whitespace-nowrap text-ground sm:text-[2.6rem]">
                {s.stat}
              </p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-olive">{s.text}</p>
              <p className="mt-4 text-xs text-olive/80">
                Source:{" "}
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-olive"
                >
                  {s.source}
                </a>
              </p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-olive">
          Findings describe EMDR delivered by trained clinicians, in person and remotely.
          Steady is a self-guided companion, not a replacement for therapy, and screens for
          who it can safely serve.
        </p>
      </section>

      {/* Companion — the delivery differentiator, placed right after the
          research band per handoff: research earns trust in the method, this
          earns trust in the delivery. Quietest section on the page. Claims
          here describe shipped behavior only; "clinical input" wording is
          deliberately avoided (no clinician advisor yet — using the
          handoff's fallback), and privacy lines match the real
          architecture: no ad trackers, member-controlled memory. */}
      <section className="mx-auto max-w-5xl px-6 pt-20">
        <div className="grid items-center gap-10 sm:grid-cols-[3fr_2fr]">
          <div>
            <h2 className="font-serif text-3xl font-medium sm:text-4xl">
              A companion built for this, and only this.
            </h2>
            <p className="mt-4 leading-relaxed text-olive">
              Steady&apos;s companion was custom-built around EMDR&apos;s session structure —
              not adapted from a general-purpose chatbot. It guides, paces, and remembers,
              inside safety rails modeled on clinical practice.
            </p>
          </div>
          {/* Product glimpse: a real exchange shape, not an AI graphic */}
          <div className="rounded-3xl border border-ground/10 bg-ivory p-5 shadow-soft" aria-hidden="true">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-3xl bg-sage/40 px-4 py-2.5 text-sm text-ground">
                Tonight feels like too much.
              </div>
            </div>
            <div className="mt-3 flex justify-start">
              <div className="max-w-[90%] rounded-3xl border border-ground/10 bg-linen px-4 py-2.5 text-sm leading-relaxed text-ground shadow-soft">
                We can keep this small. Last time, cold water on your wrists helped — want to
                start there, or just breathe together for a minute?
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {[
            {
              lead: "It remembers, so you don't start over.",
              body: "Your companion carries forward what grounds you, what's too much, and where you left off. Every session begins where you are, not at zero.",
            },
            {
              lead: "It never rushes you.",
              body: "Sessions move at your pace. Pause, ground, or stop at any moment — the companion follows your lead, every time.",
            },
            {
              lead: "It knows when to stop.",
              body: "The companion is built to recognize when a session should pause and guide you back to steady ground — and it screens for who it can safely serve before you begin.",
            },
            {
              lead: "Nothing to perform, no one to impress.",
              body: "No waiting room, no eye contact, no judgment. For many people, that privacy is what makes starting possible.",
            },
          ].map((c) => (
            <div key={c.lead} className="rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft">
              <h3 className="font-semibold">{c.lead}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-olive">{c.body}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-olive/80">
          Purpose-built for guided eye-movement sessions · Safety screening before first
          session · Private by design — no advertising trackers, and the companion&apos;s
          memory is yours to view, edit, or delete anytime · Not a replacement for therapy or
          crisis care
        </p>

        <div className="mt-8 text-center">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Cta label="Start your free week" />
            <a
              href="#how-it-works"
              className="rounded-full border border-ground/20 px-7 py-3.5 font-medium text-ground/80 transition-colors hover:bg-moss"
            >
              See how a session works
            </a>
          </div>
          <p className="mt-4 text-sm text-olive">
            7 days free · cancel anytime · stop any session, anytime
          </p>
        </div>
      </section>

      {/* Conditions */}
      <section className="mx-auto max-w-5xl px-6 pt-20">
        <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
          A steadier way through
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-olive">
          Trauma rarely travels alone. The same processing that softens a memory tends to quiet
          what it brought with it.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {CONDITIONS.map((c) => (
            <div
              key={c.name}
              className="rounded-3xl border border-ground/10 bg-ivory p-6 shadow-soft transition-colors hover:bg-linen"
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-sage" aria-hidden="true" />
              <h3 className="mt-3 font-serif text-xl font-medium">{c.name}</h3>
              <p className="mt-1 text-sm text-olive">{c.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mt-20 scroll-mt-8 bg-ground py-20 text-ivory">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
            How Steady works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-ivory/70">
            No appointments. No equipment. A few quiet minutes, whenever you have them.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title}>
                <p className="font-serif text-4xl font-medium text-sage">{i + 1}</p>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ivory/75">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Cta label="Begin when you feel ready" />
          </div>
        </div>
      </section>

      {/* Differentiators */}
      <section className="mx-auto max-w-5xl px-6 pt-20">
        <div className="grid items-start gap-10 sm:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl font-medium sm:text-4xl">
              Powerful doesn&apos;t have to mean reckless
            </h2>
            <p className="mt-4 leading-relaxed text-ground/85">
              Most self-guided programs hand you the tool and wish you luck. Steady wraps the
              same method in the safeguards a trauma clinic would insist on — so going deep
              never means going unprotected.
            </p>
            <div className="mt-6">
              <Cta />
            </div>
          </div>
          <ul className="space-y-4">
            {[
              {
                t: "A companion that remembers",
                d: "Your triggers, your calm place, what helps at 2am — recalled the next time you need it, with memory controls you own.",
              },
              {
                t: "Sessions with a chosen focus",
                d: "Before each session, Steady offers what it knows — your trigger map, your saved resources — so the work always has direction.",
              },
              {
                t: "A daily gate, not a guess",
                d: "Your 90-second check-in decides what's open today. On rough days, Steady steers you to grounding instead of pushing through.",
              },
              {
                t: "Specialist review for the deep end",
                d: "Trauma-processing modules unlock only after a licensed specialist reviews your readiness — and every session can hard-stop to protect you.",
              },
            ].map((f) => (
              <li key={f.t} className="rounded-3xl border border-ground/10 bg-linen p-5 shadow-soft">
                <h3 className="font-semibold">{f.t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-olive">{f.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Stories */}
      <section className="mx-auto max-w-5xl px-6 pt-20">
        <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
          What settling actually feels like
        </h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-3">
          {STORIES.map((s) => (
            <figure
              key={s.name}
              className="flex flex-col rounded-3xl border border-ground/10 bg-ivory p-6 shadow-soft"
            >
              <blockquote className="flex-1 leading-relaxed text-ground/90">
                “{s.quote}”
              </blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold">{s.name}</span>
                <span className="text-olive"> · {s.detail}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-olive/80">
          Illustrative member stories — composites that reflect typical experiences, not
          individual endorsements.
        </p>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-3xl px-6 pt-20">
        <div className="rounded-3xl border border-ground/10 bg-linen p-10 text-center shadow-soft">
          <h2 className="font-serif text-3xl font-medium sm:text-4xl">
            A fraction of one traditional session
          </h2>
          <p className="mx-auto mt-3 max-w-md text-olive">
            In-office EMDR often runs $150–350 an hour. Steady is built to be sustainable for
            as long as healing takes.
          </p>
          <p className="mt-8 font-serif text-6xl font-medium">
            $24.99<span className="text-2xl text-olive">/month</span>
          </p>
          <p className="mt-2 text-sm text-olive">First 7 days free</p>
          <ul className="mx-auto mt-6 max-w-md space-y-2 text-left text-sm text-ground/90">
            {[
              "Unlimited guided sessions and grounding tools",
              "Daily readiness check-ins and progress measures",
              "A companion with memory you control",
              "Specialist-informed safety review",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sage" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Cta label="Start free — decide in a week" />
          </div>
          <p className="mt-4 text-sm text-olive">
            If it doesn&apos;t feel right within your first week, cancel and pay nothing.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-6 pt-20">
        <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
          Honest answers first
        </h2>
        <div className="mt-8 space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="group rounded-3xl border border-ground/10 bg-ivory p-6 shadow-soft"
            >
              <summary className="cursor-pointer list-none font-semibold text-ground marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {f.q}
                  <span
                    className="text-olive transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-olive">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Who this is for */}
      <section className="mx-auto max-w-3xl px-6 pt-16">
        <div className="rounded-3xl border border-ground/10 bg-linen p-7 text-sm leading-relaxed text-olive shadow-soft">
          <h2 className="font-serif text-xl font-medium text-ground">Who Steady is for</h2>
          <p className="mt-2">
            Adults with trauma-related symptoms who pass screening, are not in acute crisis, and
            can work through structured material with remote specialist backup. It is not
            suitable for emergencies, for minors, or for people with active suicidal intent,
            psychosis, or uncontrolled dissociative crises — screening will route to appropriate
            help instead. Steady is care software, not a replacement for therapy or emergency
            care.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="font-serif text-4xl leading-tight font-medium sm:text-5xl">
          Your nervous system deserves
          <br />a steady place to land.
        </h2>
        <div className="mt-8">
          <Cta label="Start your free week" />
        </div>
        <p className="mt-4 text-sm text-olive">
          Or{" "}
          <Link href="/login" className="underline">
            sign in
          </Link>{" "}
          if you already have a space here.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-ground/10 bg-ivory">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-6 py-10 text-center text-xs text-olive">
          <div className="flex items-center gap-2">
            <SteadyMark className="h-6 w-6 text-olive" />
            <Wordmark className="text-xl" />
          </div>
          <p>
            Not an emergency service. In crisis, call or text 988 (Suicide &amp; Crisis
            Lifeline) or call 911. No advertising trackers · full audit trail · your data stays
            yours.
          </p>
        </div>
      </footer>
    </main>
  );
}
