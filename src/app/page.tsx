import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SteadyMark, Wordmark } from "@/components/Brand";
import { CalmScene, LeafSprig, SoftWave, WarmWash } from "@/components/Illustrations";
import { PLANS, TRIAL_DAYS, type PlanId } from "@/lib/billing";

// Marketing landing page. The voice is "calm conviction": the benefit-led
// structure of direct-to-consumer EMDR marketing (outcomes, research,
// conditions, stories, guarantee) carried by Steady's slow, grounded visual
// language. Every claim about EMDR is about the method, not this product;
// member stories are illustrative and labeled as such.

const CONDITIONS = [
  { name: "PTSD & trauma", note: "Single events or long histories" },
  { name: "Anxiety & panic", note: "The alarm that won't switch off" },
  { name: "Grief & loss", note: "When it stays frozen in place" },
  { name: "Sleep & nightmares", note: "When nights won't settle" },
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
    title: "Practice",
    body: "A few minutes of paced breathing, guided meditation, gentle movement, or a sleep wind-down — the daily work that makes the deeper work possible.",
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

// The Base-tier daily toolkit — every tile is shipped product.
const DAILY_TOOLKIT = [
  { name: "Breathe", note: "Five paced patterns, from a quick reset to a slow wind-down. No-hold options always available." },
  { name: "Meditate", note: "Short guided practices — orienting, calm place, self-compassion — read aloud or as text." },
  { name: "Move", note: "Gentle guided movement: orienting turns, rooting down, shaking off held stress. Seated options throughout." },
  { name: "Sleep", note: "Wind-downs to do lying down in the dark, that trail off into permission to sleep." },
  { name: "Learn", note: "Two-to-four-minute reads that make sense of the work — the window of tolerance, triggers, why the method helps." },
  { name: "SOS", note: "One tap, on every screen: your calm place, your grounding tools, your safe person, and the crisis line." },
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
      "The check-in stopped me from pushing on a bad day, and honestly that's when I started trusting it. Now the two-minute breath before work is the habit that makes the rest possible.",
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
    q: "What is Autopilot?",
    a: "Autopilot is Premium's autonomous care loop. Each morning it composes your day — the right practice, the next safe program step, a short read — from your check-in and your history. It reaches out through your companion when you've gone quiet or your measures show a rough stretch, adapts your pacing automatically, and surfaces worsening trends to your specialist early. It works inside the same safety gates as everything else: it can make a day gentler, never riskier.",
  },
  {
    q: "What does it cost?",
    a: "Three memberships: Base ($6.99/month) is the daily practice, Plus ($19.99) adds the guided program and unlimited companion with memory, and Premium ($34.99) adds Autopilot, live sessions, and priority review. Every membership starts with 7 days of Premium, free — and crisis support and grounding stay open to everyone, regardless of membership.",
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
  const demo = process.env.EMDR_DEMO === "1";

  return (
    <main className="overflow-x-clip">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 pt-8">
        <div className="flex items-center gap-2 sm:gap-3">
          <SteadyMark className="h-8 w-8 text-olive sm:h-9 sm:w-9" />
          <Wordmark className="text-2xl sm:text-3xl" />
        </div>
        <div className="flex items-center gap-3 text-sm sm:gap-5">
          <nav className="hidden items-center gap-5 text-olive md:flex" aria-label="Page sections">
            <a href="#how-it-works" className="transition-colors hover:text-ground">How it works</a>
            <a href="#your-day" className="transition-colors hover:text-ground">Your day</a>
            <a href="#autopilot" className="transition-colors hover:text-ground">Autopilot</a>
            <a href="#pricing" className="transition-colors hover:text-ground">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-ground">FAQ</a>
          </nav>
          <Link href="/crisis" className="font-semibold whitespace-nowrap text-support underline">
            Need help now?
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-ground/20 px-4 py-2 text-ground/80 transition-colors hover:bg-moss sm:px-5"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto max-w-5xl px-6 pt-14 sm:pt-20">
        <WarmWash />
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
              daily breathwork, meditation, movement, and sleep practices, a companion that
              remembers what helps you, and safety rails a clinician would recognize.
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
              7 days of Premium free · from $6.99/month after · cancel anytime — no
              equipment needed, just a quiet moment
            </p>
          </div>

          {/* Warm hero scene: a person sitting calmly at sunrise. The sun keeps
              the breath-paced motion; disabled under reduced-motion. */}
          <div className="relative mx-auto w-full max-w-xs sm:max-w-sm">
            <CalmScene className="w-full" />
            <p className="mt-3 text-center font-serif text-lg text-olive">breathe out longer</p>
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
              <p className="mt-4 text-xs text-olive">
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
              inside safety rails modeled on professional practice.
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

        <p className="mt-6 text-center text-xs text-olive">
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
        <LeafSprig className="mx-auto h-9 w-9" />
        <h2 className="mt-3 text-center font-serif text-3xl font-medium sm:text-4xl">
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

      {/* The daily toolkit — the Base-tier engagement story: Steady is a daily
          practice first, a session program second. Every tile is shipped. */}
      <section id="your-day" className="mx-auto max-w-5xl scroll-mt-8 px-6 pt-20">
        <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
          Every day, not just sessions
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-olive">
          Healing mostly happens between the big moments. Steady gives you a daily toolkit —
          and on harder days, gentler practices surface first, automatically.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DAILY_TOOLKIT.map((t) => (
            <div
              key={t.name}
              className="rounded-3xl border border-ground/10 bg-linen p-6 shadow-soft transition-colors hover:bg-moss"
            >
              <h3 className="font-serif text-2xl font-medium">{t.name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-olive">{t.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-olive">
          All six are part of every membership, starting at $6.99/month. SOS, grounding, and
          crisis support stay open to everyone — members or not.
        </p>
      </section>

      {/* How it works — organic wave softens the seam into the dark band */}
      <SoftWave className="mt-20 block h-16 w-full sm:h-24" fill="var(--color-ground)" />
      <section id="how-it-works" className="-mt-px scroll-mt-8 bg-ground py-20 text-ivory">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
            How Steady works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-ivory/70">
            No appointments. No equipment. A few quiet minutes, whenever you have them.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
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

      {/* Autopilot — the Premium differentiator. Claims describe shipped
          behavior; the safety framing ("only ever makes a day gentler") is the
          engine's real invariant, not marketing. */}
      <section id="autopilot" className="mx-auto max-w-5xl scroll-mt-8 px-6 pt-20">
        <div className="grid items-center gap-10 sm:grid-cols-[3fr_2fr]">
          <div>
            <p className="text-sm font-semibold tracking-wide text-olive uppercase">
              Premium · Autopilot
            </p>
            <h2 className="mt-3 font-serif text-3xl font-medium sm:text-4xl">
              Steady runs the program with you
            </h2>
            <p className="mt-4 leading-relaxed text-ground/85">
              Most apps wait for you to show up. Autopilot acts between sessions: it composes
              your day each morning from your check-in and your history, reaches out when
              you&apos;ve gone quiet or a rough stretch shows in your measures, and adapts your
              pacing automatically — always inside the same safety gates, only ever making a
              day gentler.
            </p>
          </div>
          {/* Product glimpse: a real composed plan shape */}
          <div className="rounded-3xl border border-sage-deep/40 bg-moss p-5 shadow-soft" aria-hidden="true">
            <p className="text-xs text-olive">Autopilot · today&apos;s plan</p>
            <p className="mt-1 font-serif text-xl font-medium text-ground">A gentle day, on purpose</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="rounded-2xl border border-ground/10 bg-linen px-4 py-2.5">Orienting to now · 2 min</div>
              <div className="rounded-2xl border border-ground/10 bg-linen px-4 py-2.5">Your grounding tools</div>
              <div className="rounded-2xl border border-ground/10 bg-linen px-4 py-2.5">Read: your nervous system on high alert</div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-olive">
              Sessions set aside today — protecting your window is progress too.
            </p>
          </div>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "A plan, every morning", d: "Composed from your check-in, your program, and what you haven't tried yet." },
            { t: "It reaches out first", d: "Miss a few days or trend downward on your measures, and your companion checks in — warmly, without pressure." },
            { t: "Pacing that adapts", d: "Hard days automatically narrow to grounding; steady days move the program forward. You see what changed and why." },
            { t: "Earlier human review", d: "Worsening trends surface to your specialist before you have to ask — and Premium requests go to the top of the queue." },
          ].map((c) => (
            <div key={c.t} className="rounded-3xl border border-ground/10 bg-ivory p-5 shadow-soft">
              <h3 className="text-sm font-semibold">{c.t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-olive">{c.d}</p>
            </div>
          ))}
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
        <p className="mt-4 text-center text-xs text-olive">
          Illustrative member stories — composites that reflect typical experiences, not
          individual endorsements. Individual experiences vary; Steady is not therapy or
          medical treatment.
        </p>
      </section>

      {/* Pricing — mirrors /subscribe word-for-word so the story never shifts
          between pages. Plus is the highlighted anchor. */}
      <section id="pricing" className="mx-auto max-w-5xl scroll-mt-8 px-6 pt-20">
        <h2 className="text-center font-serif text-3xl font-medium sm:text-4xl">
          A fraction of one traditional session
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-olive">
          In-office EMDR often runs $150–350 an hour. Steady starts at{" "}
          <strong>$6.99 a month</strong>, and every membership begins with{" "}
          <strong>{TRIAL_DAYS} days of Premium, free</strong> — the full program, the
          companion, Autopilot, everything.
        </p>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {(["base", "plus", "premium"] as PlanId[]).map((id) => {
            const plan = PLANS[id];
            const highlighted = id === "plus";
            return (
              <div
                key={id}
                className={`flex flex-col rounded-3xl border p-7 shadow-soft ${
                  highlighted ? "border-sage-deep bg-moss" : "border-ground/10 bg-linen"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-serif text-2xl font-medium">{plan.label}</h3>
                  {highlighted && (
                    <span className="rounded-full bg-sage/40 px-3 py-1 text-xs font-medium text-ground">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-olive">{plan.tagline}</p>
                <p className="mt-4 font-serif text-4xl font-medium">
                  ${(plan.priceCents / 100).toFixed(2)}
                  <span className="text-base font-normal text-olive">/month</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-ground/90">
                  {plan.includes.map((line) => (
                    <li key={line} className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sage" aria-hidden="true" />
                      {line}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  <Link
                    href="/signup"
                    className={`block rounded-full px-6 py-3 text-center font-medium transition-colors ${
                      highlighted
                        ? "bg-sage text-ground hover:bg-sage-deep"
                        : "border border-ground/20 text-ground hover:bg-moss"
                    }`}
                  >
                    Start free — then {plan.label}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-sm text-olive">
          If it doesn&apos;t feel right within your first week, cancel and pay nothing. Crisis
          support, grounding, and SOS stay open to everyone — on every tier, and on none.
        </p>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-8 px-6 pt-20">
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

      {/* Roadmap strip — DEMO ONLY (EMDR_DEMO=1): shown to investors/preview
          audiences, never rendered in production. Everything above this line is
          shipped; everything in this strip is explicitly labeled as coming. */}
      {demo && (
        <section className="mx-auto max-w-5xl px-6 pt-16">
          <div className="rounded-3xl border border-pause/40 bg-pause-soft p-7">
            <p className="text-xs font-semibold tracking-wide text-olive uppercase">
              Preview build · on the roadmap
            </p>
            <h2 className="mt-2 font-serif text-2xl font-medium">
              Everything above is live today. Here&apos;s what&apos;s next.
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
              {[
                { t: "Push-delivered outreach", d: "Autopilot's check-ins arrive on your phone, not just in the app." },
                { t: "Apple Watch", d: "Grounding and paced breathing from the wrist, with haptic bilateral taps." },
                { t: "HealthKit-informed pacing", d: "Sleep and heart-rate trends (with consent) sharpen the daily plan." },
                { t: "A naturally narrated voice", d: "Studio-quality session narration — pre-rendered, still nothing leaving the device." },
              ].map((r) => (
                <div key={r.t} className="rounded-2xl border border-ground/10 bg-ivory p-4">
                  <h3 className="font-semibold">{r.t}</h3>
                  <p className="mt-1 leading-relaxed text-olive">{r.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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
      <section className="relative mx-auto mt-10 max-w-3xl overflow-hidden rounded-[2.5rem] px-6 py-20 text-center">
        <WarmWash />
        <LeafSprig className="mx-auto h-10 w-10" />
        <h2 className="mt-3 font-serif text-4xl leading-tight font-medium sm:text-5xl">
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
