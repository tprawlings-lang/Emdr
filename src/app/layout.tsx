import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import SosMount from "@/components/SosMount";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: "steady — a steadier way through trauma",
  description:
    "A calm, private, self-guided wellness program built on the EMDR method — guided sessions, grounding tools, and a companion that remembers. Not therapy, and not for emergency use.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const demo = process.env.EMDR_DEMO === "1";
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${cormorant.variable}`}>
      <body className="min-h-full flex flex-col bg-ivory font-sans text-ground">
        {demo && (
          <div className="bg-ground px-4 py-2 text-center text-sm text-ivory/90">
            <strong>Demonstration environment.</strong> All people and data are fictional and
            reset periodically. Member: demo@example.com · Clinician: clinician@example.com ·
            password demo1234 — or{" "}
            <a href="/signup" className="underline">create your own account</a>
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
