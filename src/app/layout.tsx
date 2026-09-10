import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import type { Metadata } from "next";
import { Inter, Literata } from "next/font/google";
import "./globals.css";
import SosMount from "@/components/SosMount";
import { ReviewGuide } from "@/components/ReviewGuide";
import { SkipLink } from "@/components/experience/SkipLink";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// §12.3's identity serif. Text-grade by design — see the note in globals.css.
const literata = Literata({ subsets: ["latin"], variable: "--font-literata" });

export const metadata: Metadata = {
  title: "steady — a steadier way through trauma",
  description:
    "A calm, private, self-guided wellness program built on the EMDR method — guided sessions, grounding tools, and a companion that remembers. Not therapy, and not for emergency use.",
};

/** Names who is signed in, and says whether they are a real person.
 *
 *  Handoff §2: "any screen that resembles a live service must carry the
 *  persistent demo banner AND a fabricated persona indicator." The banner says
 *  the environment is fake; this says *who you are pretending to be*, which is
 *  the part a viewer forgets three screens into a walkthrough.
 *
 *  IT USED TO SAY "FABRICATED" ABOUT EVERYBODY, and once enrollment existed
 *  that was a false statement on screen. A person who enrolled saw their own
 *  name called invented, and anyone reading over their shoulder was told that
 *  real answers — a real safety screener, a real check-in — were synthetic
 *  data. The first is unpleasant; the second is the one that matters, because
 *  the whole point of the banner is to stop a screenshot being mistaken for a
 *  record, and mislabelling in this direction makes a record look like a
 *  screenshot.
 *
 *  So it asks. Fabricated stays the default when the lookup finds nothing:
 *  every seeded person has a row, so an absent one is a failed query rather
 *  than evidence about a human being. */
async function PersonaIndicator() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  const { personIsReal } = await import("@/lib/enrollment/gate");
  const real = await personIsReal(user.id).catch(() => false);
  return (
    <span className="mt-1 inline-block rounded-full bg-ivory/15 px-2 py-0.5 text-xs text-ivory">
      {real ? (
        <>
          Pilot account: <strong>{user.name}</strong> ({user.role}) &mdash; a real account, not a
          fabricated persona
        </>
      ) : (
        <>
          Fabricated persona: <strong>{user.name}</strong> ({user.role})
        </>
      )}
    </span>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const demo = process.env.EMDR_DEMO === "1";
  // Read here rather than imported from the gate module: this is a layout,
  // it renders on every request, and the question is only ever "is the door
  // open", which the variable answers without a database read.
  const enrolling = Boolean(process.env.EMDR_ENROLLMENT_CODE);
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${literata.variable}`}>
      <body className="min-h-full flex flex-col bg-ivory font-sans text-ground">
        {/* First in the DOM on purpose: a skip link that comes after the demo
            banner and the review strip skips neither. */}
        <SkipLink />
        {demo && (
          // Handoff §1 and §3: every surface carries this label, in these
          // words, and it is not dismissible.
          //
          // Credentials were removed from this banner deliberately. §3 forbids
          // exposing shared passwords here — a password printed on every page
          // of an environment shaped like a clinical record is an invitation
          // that survives every other access control. Reviewers now enter
          // through /request-review, which issues access and selects a
          // fabricated persona without ever showing a password.
          <div
            role="note"
            aria-label="Demonstration environment notice"
            className="bg-ground px-4 py-2 text-center text-sm text-ivory"
          >
            {/* THE HEADER IS A CATEGORY, AND IT STAYS. "Demo, fabricated data,
                not clinical care" describes what this deployment is — 240
                fabricated profiles and at most 25 pilot accounts — and four
                specs and two guards read it as the environment's name. The
                sentence below is where the false claim actually lived. */}
            <strong className="tracking-wide">DEMO — FABRICATED DATA — NOT CLINICAL CARE</strong>
            <span className="block text-ivory/90">
              {enrolling ? (
                // THE BANNER STOPPED BEING TRUE, so it changed rather than
                // staying put. With enrollment open, "every person here is
                // invented" is a false statement printed directly above a form
                // collecting a real person's name and, two screens later, their
                // answer to whether they have had suicidal thoughts this month.
                //
                // A banner that asserts something the reader can see is untrue
                // does not merely fail at its own job — it teaches people that
                // the notices on this product are decoration, which is the
                // opposite of what every other one is for. So it says the
                // narrower thing that is still true: the population is
                // fabricated, some accounts are not, and neither is care.
                <>
                  The seeded population is fabricated, and pilot accounts are real people
                  entering their own answers. Neither is clinical care, and nothing here is
                  monitored in real time.{" "}
                  <a href="/request-review" className="underline">Request review access</a>
                </>
              ) : (
                <>
                  Every person, record, and clinician here is invented. Nothing in this
                  environment is a real member, real health information, or approved care.{" "}
                  <a href="/request-review" className="underline">Request review access</a>
                </>
              )}
            </span>
            <Suspense fallback={null}>
              <PersonaIndicator />
            </Suspense>
          </div>
        )}
        {/* The guided review strip. Renders only for someone holding a review
            grant, so it is scaffolding for reviewing the product rather than
            part of it. */}
        <Suspense fallback={null}>
          <ReviewGuide />
        </Suspense>
        <div className="flex-1">{children}</div>
        <SosMount />
        <footer className="mx-auto w-full max-w-3xl px-6 py-10 text-center text-sm text-olive">
          <p className="font-medium">
            Steady is not emergency care. In the US, call or text{" "}
            <a href="tel:988" className="font-semibold underline">988</a> (Suicide &amp; Crisis
            Lifeline) or call 911 if you are in immediate danger.
          </p>
          <p className="mt-2">
            Steady is a self-guided wellness program. It is not therapy, medical care, or a
            substitute for professional treatment, and it does not diagnose or treat any
            condition.
          </p>
          <p className="mt-2">
            Development prototype — not a medical device and not cleared for clinical use.
          </p>
          <p className="mt-2">
            <a href="/terms" className="underline">Terms of Service</a> ·{" "}
            <a href="/privacy" className="underline">Privacy Policy</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
