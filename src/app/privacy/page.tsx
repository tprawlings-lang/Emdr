import Link from "next/link";
import { PRIVACY_VERSION } from "@/lib/policy";

// Privacy Policy (compliance packet 3.5). The packet's rule: this document
// describes ONLY what the code actually does. Every statement below maps to
// implemented behavior; if a feature changes, this page and PRIVACY_VERSION
// must change with it. Reviewed and approved by counsel 2026-06-10 (per
// founder); wording changes require re-review.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl font-medium">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-ground/90">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-serif text-4xl font-medium">Privacy Policy</h1>
      <p className="mt-2 text-sm text-olive">
        Version {PRIVACY_VERSION} · Effective June 10, 2026 · Every statement here describes
        what the software actually does today.
      </p>

      <Section title="What we collect">
        <p>
          <strong>Account:</strong> your name, email address, date of birth (to verify you
          are 18+), and a salted hash of your password — never the password itself.
        </p>
        <p>
          <strong>Wellness data you enter:</strong> daily check-in ratings, distress (SUDs)
          ratings around sessions, your trigger map, early-warning signs, your safety plan,
          program-fit and questionnaire answers, session records (module, timing,
          completion, ratings), companion conversations, and what you ask the companion to
          remember.
        </p>
        <p>
          <strong>Operational records:</strong> an append-only audit log of events (logins,
          consents, session start/stop, coded safety events). Audit entries contain event
          types and identifiers — not the content of anything you wrote.
        </p>
        <p>
          <strong>Billing:</strong> subscription status and payment history. Card details
          never touch our servers.
        </p>
        <p>
          We deliberately do not collect diagnosis fields, medication lists, or clinical
          history forms.
        </p>
      </Section>

      <Section title="What we never do">
        <p>
          No advertising trackers, marketing pixels, analytics scripts, or session-replay
          tools — anywhere, including the public homepage. We do not sell your data, share
          it with advertisers, or use it for marketing. There are no third-party scripts in
          the app at all.
        </p>
      </Section>

      <Section title="How your data is protected">
        <p>
          All traffic is encrypted in transit (TLS, with HSTS). Storage disks are encrypted
          at rest by our hosting platform. On top of that, everything you write in free text
          — companion messages, what the companion remembers, trigger notes, your safety
          plan, questionnaire answers — is additionally encrypted at the application layer
          (AES-256-GCM) with a key held in the platform&apos;s secrets manager, so a copy of
          the database alone does not expose what you wrote. The database is not reachable
          from the public internet.
        </p>
      </Section>

      <Section title="The companion and AI processing">
        <p>
          When you message the companion, your message, recent conversation history, and
          relevant program context (your preferences, triggers, safety plan, check-in
          numbers, stored memories) are sent to our AI service provider, Anthropic, to
          generate the reply. We use Anthropic&apos;s commercial API, which under
          Anthropic&apos;s usage policies does not use API customer data to train its models.
          Crisis-risk detection runs on our own servers before any AI call, and crisis
          replies are scripted, not AI-generated.
        </p>
        <p>
          You control the companion&apos;s memory: view, deactivate single items, or clear
          it entirely from Settings → Memory, or turn memory off altogether.
        </p>
      </Section>

      <Section title="Who can see your data">
        <p>
          You; reviewers with a safety role inside the program (who review readiness,
          unlock requests, and safety alerts); and the engineers who operate the service,
          under access controls and the audit log. No one watches in real time.
        </p>
      </Section>

      <Section title="Deletion and retention">
        <p>
          <strong>Delete anytime, no reason required:</strong> Settings → Account → Delete.
          Your program data (sessions, check-ins, triggers, safety plan, conversations,
          memory, questionnaire answers) is removed immediately and your account is
          anonymized. Payment records are kept only as financial law requires. Encrypted
          backups age out within 30 days.
        </p>
        <p>
          Accounts inactive for 24 months are deleted on the same basis. Consent and audit
          ledger entries are retained as integrity records but contain no free-text content.
        </p>
      </Section>

      <Section title="If something goes wrong">
        <p>
          If a breach of unsecured identifiable data occurs, we follow the FTC Health Breach
          Notification Rule: affected users and the FTC are notified within 60 days of
          discovery, and our incident-response runbook governs the first hours. We treat
          this rule as applying to us even though we are a wellness product, not a HIPAA
          covered entity.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Regardless of where you live, we honor: access to what the companion remembers
          (Settings → Memory), deletion without a reason (Settings → Account), and consent
          withdrawal. Residents of states with consumer-health-data laws (e.g. Washington
          My Health My Data) have these rights by statute; we apply them to everyone.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          This policy is versioned ({PRIVACY_VERSION}). The privacy policy only ever
          describes what the code actually does; if behavior changes, the policy and
          version change with it, and we will show you what changed.
        </p>
      </Section>

      <p className="mt-10 text-center text-xs text-olive">
        <Link href="/terms" className="underline">Terms of Service</Link> ·{" "}
        <Link href="/" className="underline">Home</Link>
      </p>
    </main>
  );
}
