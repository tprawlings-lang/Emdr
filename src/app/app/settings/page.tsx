import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { MemberPage } from "@/components/member/MemberPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile and privacy — Steady" };

// Profile and privacy (§26: "Manage account and data choices — identity,
// sharing, requests — Save changes").
//
// /settings never had an index. Five sub-pages existed and nothing listed
// them, so the nav link and every "settings" reference resolved to a 404 —
// which the route migration inherited and papered over with a redirect to
// /app/settings/account. This is the page that redirect was standing in for.
//
// Grouped by what the member is deciding, not by which table the data lives in.
// "What Steady keeps" is its own group because §26 puts data choices at the top
// of this screen's job, and because a member looking for it should not have to
// guess whether memory is an account setting or a privacy one.

const GROUPS: Array<{ heading: string; items: Array<{ href: string; label: string; body: string }> }> = [
  {
    heading: "What Steady keeps",
    items: [
      { href: "/app/settings/memory", label: "Companion memory",
        body: "See everything the companion remembers about you, and remove any of it." },
      { href: "/app/settings/voice", label: "Voice",
        body: "Whether sessions can be spoken aloud, and whether your voice is used at all." },
    ],
  },
  {
    heading: "Your account",
    items: [
      { href: "/app/settings/account", label: "Account",
        body: "Your name, sign-in details, and closing your account." },
      { href: "/app/settings/billing", label: "Membership",
        body: "What is active, and what happens to your records if it ends." },
      { href: "/app/settings/sessions", label: "Signed-in devices",
        body: "Where you are signed in, and signing out everywhere at once." },
    ],
  },
  {
    heading: "Who can see your information",
    items: [
      { href: "/app/care-team", label: "Care team",
        body: "Who has access, what they can see, and how to withdraw it." },
      { href: "/app/consent", label: "Consent and sharing",
        body: "What you have agreed to, when, and under which version of the terms." },
      { href: "/app/messages", label: "Messages",
        body: "Secure messaging with a care team, and what is available instead." },
      { href: "/app/welcome", label: "What Steady is",
        body: "Scope, what decides what you see, and what stays yours." },
    ],
  },
];

export default async function SettingsPage() {
  await requireMember();
  return (
    <MemberPage
      title="Profile and privacy"
      lede="Your account, and the choices about what Steady keeps and who can see it."
    >
      <div className="space-y-8">
        {GROUPS.map((g) => (
          <section key={g.heading} aria-labelledby={g.heading}>
            <h2 id={g.heading} className="text-xs font-semibold uppercase tracking-wide text-olive">
              {g.heading}
            </h2>
            <ul className="mt-3 space-y-3">
              {g.items.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    className="block rounded-3xl border border-ground/10 bg-linen p-5 transition-colors hover:border-ground/25"
                  >
                    <p className="font-medium text-ground">{i.label}</p>
                    <p className="measure mt-1 text-sm text-olive">{i.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </MemberPage>
  );
}
