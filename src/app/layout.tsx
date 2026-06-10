import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steady — Supervised Trauma Care Support",
  description:
    "EMDR-informed, clinician-supervised care software for adults with trauma-related symptoms. Not for emergency use.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <div className="flex-1">{children}</div>
        <footer className="mx-auto w-full max-w-3xl px-6 py-8 text-center text-sm text-stone-500">
          <p className="font-medium text-stone-600">
            Not for emergency use. In the US, call or text{" "}
            <a href="tel:988" className="font-semibold underline">988</a> (Suicide &amp; Crisis
            Lifeline) or call 911 if you are in immediate danger.
          </p>
          <p className="mt-2">
            Development prototype — not a medical device and not cleared for clinical use.
          </p>
        </footer>
      </body>
    </html>
  );
}
