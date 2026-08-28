import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SosMount from "@/components/SosMount";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "steady — a steadier way through trauma",
  description:
    "A calm, private, self-guided wellness program built on the EMDR method — guided sessions, grounding tools, and a companion that remembers. Not therapy, and not for emergency use.",
};

/** Names the fabricated persona currently signed in.
 *
 *  Handoff §2: "any screen that resembles a live service must carry the
 *  persistent demo banner AND a fabricated persona indicator." The banner says
 *  the environment is fake; this says *who you are pretending to be*, which is
 *  the part a viewer forgets three screens into a walkthrough. */
async function PersonaIndicator() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  return (
    <span className="mt-1 inline-block rounded-full bg-ivory/15 px-2 py-0.5 text-xs text-ivory">
      Fabricated persona: <strong>{user.name}</strong> ({user.role})
    </span>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const demo = process.env.EMDR_DEMO === "1";
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full flex flex-col bg-ivory font-sans text-ground">
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
            <strong className="tracking-wide">DEMO — FABRICATED DATA — NOT CLINICAL CARE</strong>
            <span className="block text-ivory/90">
              Every person, record, and clinician here is invented. Nothing in this
              environment is a real member, real health information, or approved care.{" "}
              <a href="/request-review" className="underline">Request review access</a>
            </span>
            <Suspense fallback={null}>
              <PersonaIndicator />
            </Suspense>
          </div>
        )}
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
