import Link from "next/link";
import { ReviewPage } from "@/components/clinical/ReviewPage";
import { Panel, Note, WithNote, Callout } from "@/components/app/surfaces";
import { requireReviewAccess } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { runIdentityScan, SCAN_RULES, SCAN_BOUNDARY, type ScanSeverity } from "@/lib/demo-identity-scan";
import { demoBaseline } from "@/lib/demo-reset";
import { runQualityChecks, qualitySummary } from "@/lib/demo-quality";
import { DEMO_SEED_VERSION } from "@/lib/demo-seed";
import { DATASET_VERSION } from "@/lib/demo-population-manifest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo data — Steady Review" };

// Demo data (§26 p44: "/review/demo-data — Reset and verify fabricated data —
// seed, scan, reset — Run identity scan").
//
// THE ATLAS MAKES THE SCAN THE PRIMARY ACTION, NOT THE RESET, and that is the
// right way round. A reviewer is being asked to accept a large claim on trust
// — that none of these seventeen thousand people exist — and a reset button
// does nothing whatever to support it. The scan does, by looking for the marks
// a real person leaves in a dataset and reporting what it found, what it could
// not read, and what it did not cover.
//
// RESETTING IS NOT OFFERED HERE. It already exists on the demo administration
// console, with a typed reason and an audit entry, and putting a second copy
// of a control that deletes every row onto a screen most of whose readers
// cannot use it would make the environment easier to destroy and no easier to
// verify. This screen says where the control is and what it does instead.

const SEVERITY: Record<ScanSeverity, { word: string; glyph: string; tone: "safe" | "caution" | "support" | "info"; meaning: string }> = {
  clean: {
    word: "Clean",
    glyph: "◆",
    tone: "safe",
    meaning: "Nothing in the fabricated population's readable columns is shaped like a real-world identifier.",
  },
  suspect: {
    word: "Suspect",
    glyph: "▲",
    tone: "caution",
    meaning: "Something is shaped like a real-world identifier. It may be invented and still look like one — the findings below say where to look.",
  },
  contaminated: {
    word: "Contaminated",
    glyph: "▲",
    tone: "support",
    meaning: "Something that could reach or identify a person is in the fabricated data, or a person's provenance was never stated. This environment should not be demonstrated until it is resolved.",
  },
  nothing_to_scan: {
    word: "Nothing to scan",
    glyph: "○",
    tone: "info",
    meaning: "There is no fabricated population here to check. This is not a pass — it is the absence of anything to pass.",
  },
};

export default async function ReviewDemoDataPage({
  searchParams,
}: {
  searchParams: Promise<{ fingerprint?: string }>;
}) {
  const user = await requireReviewAccess();
  const { fingerprint } = await searchParams;
  const db = getDb();

  const scan = runIdentityScan(db);
  const quality = runQualityChecks(db);
  const summary = qualitySummary(quality);
  // Behind an explicit request: it reads every row of every demo table and
  // hashes them, which is most of a second. A page that costs that on every
  // load teaches people not to open it.
  const baseline = fingerprint === "1" ? demoBaseline(db) : null;

  const sev = SEVERITY[scan.severity];
  const failed = quality.filter((q) => !q.pass);

  return (
    <ReviewPage
      layer="evidence"
      here="/review/demo-data"
      title="Demo data"
      lede="What this environment's data is, whether anything in it could belong to a real person, and which parts of that question were not answered."
    >
      <WithNote
        note={
          <Note
            tone={sev.tone}
            title={`${sev.glyph} ${sev.word}`}
            owner={user.name}
            boundary={SCAN_BOUNDARY}
          >
            <p>{sev.meaning}</p>
          </Note>
        }
      >
        <Panel
          title="Identity scan"
          footnote={`Ran ${scan.ranAt}, when this page loaded. ${scan.scanned} values read across ${scan.fabricatedPeople} fabricated people; ${scan.unreadable} could not be read because they are encrypted at rest.`}
        >
          {scan.findings.length === 0 ? (
            <p className="measure text-sm text-ground">
              No value matched any of the {SCAN_RULES.length} patterns below.
            </p>
          ) : (
            <ul className="divide-y divide-ground/5">
              {scan.findings.slice(0, 50).map((f, i) => (
                <li key={`${f.table}.${f.column}.${f.rowId}.${i}`} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-medium text-app-ink">{f.kind}</span>
                    <span className="font-mono text-xs text-olive">
                      {f.table}.{f.column} · {f.rowId}
                    </span>
                  </div>
                  {/* The shape, never the value. Printing a candidate real
                      identifier onto a review screen would republish the thing
                      this exists to find. */}
                  <p className="mt-0.5 font-mono text-xs text-state-support">{f.shape}</p>
                </li>
              ))}
            </ul>
          )}

          {scan.peopleWithoutProvenance > 0 && (
            <p className="measure mt-4 text-sm text-state-support">
              <span aria-hidden>▲</span> {scan.peopleWithoutProvenance} people have no stated
              provenance. The write guard requires one, so these rows predate it — and the scan
              cannot say which population they belong to.
            </p>
          )}

          <p className="measure mt-4 text-sm text-olive">
            {scan.realPeople} people in this environment are marked real. That is reported, not
            judged: somebody signing up here is legitimate, their own details are theirs, and
            their records are outside this scan by construction.
          </p>

          <p className="mt-4">
            <Link
              href="/review/demo-data"
              className="inline-block rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink"
            >
              Run identity scan again
            </Link>
          </p>
        </Panel>
      </WithNote>

      <Panel
        title="What it looks for"
        className="mt-6"
        footnote="Every rule is proved by a guard that plants the thing it looks for. A scanner verified only against clean data is a scanner verified against nothing."
      >
        <dl className="space-y-3">
          {SCAN_RULES.map((r) => (
            <div key={r.kind}>
              <dt className="text-sm font-medium text-app-ink">{r.kind}</dt>
              <dd className="measure text-sm text-ground">{r.because}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel
        title="What it read, and what it could not"
        className="mt-6"
        footnote="Coverage is stated per column. A scan whose coverage shrinks in silence is how a check keeps passing after it has stopped checking."
      >
        <ul className="divide-y divide-ground/5">
          {scan.coverage.map((c) => (
            <li
              key={`${c.table}.${c.column}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
            >
              <span className="font-mono text-xs text-ground">
                {c.table}.{c.column}
              </span>
              <span className="text-xs text-olive">
                {c.absent ? (
                  <span className="text-state-caution">
                    <span aria-hidden>▲</span> not in this schema — not scanned
                  </span>
                ) : (
                  <>
                    {c.scanned} read
                    {c.encrypted > 0 && (
                      <span className="text-state-info"> · {c.encrypted} encrypted, not read</span>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="The seed"
        className="mt-6"
        footnote="The dataset is deterministic: the same versions rebuild the same rows, and the fingerprint is how two rebuilds are compared rather than eyeballed."
      >
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {[
            ["Demo seed", DEMO_SEED_VERSION],
            ["Fabricated population", DATASET_VERSION],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ground/5 py-1.5">
              <dt className="text-sm text-olive">{label}</dt>
              <dd className="font-mono text-xs text-ground">{value}</dd>
            </div>
          ))}
        </dl>

        {baseline ? (
          <>
            <p className="mt-4 text-sm text-app-ink">
              Fingerprint <span className="font-mono text-xs">{baseline.hash}</span>
            </p>
            <p className="measure mt-1 text-xs text-olive">
              sha256 over every demo table, excluding timestamps and ciphertext — the first move
              between resets by design, the second differs on every write because each uses a
              fresh nonce. Covering either would make the fingerprint change for a reason
              unrelated to whether the dataset was reproduced.
            </p>
          </>
        ) : (
          <p className="mt-4">
            <Link
              href="/review/demo-data?fingerprint=1"
              className="inline-block rounded-full bg-app-accent px-4 py-2 text-sm font-medium text-app-ink"
            >
              Fingerprint the dataset
            </Link>
            <span className="ml-3 text-xs text-olive">
              Reads every row of every demo table. Roughly a second.
            </span>
          </p>
        )}
      </Panel>

      <Panel
        title="The data-quality manifest"
        className="mt-6"
        footnote="Computed now against this database. A manifest recorded at build time reports the state of the last good build, which is the one thing a reviewer does not need to know."
      >
        <p className="measure text-sm text-ground">
          {summary.passed} of {quality.length} checks pass.
        </p>
        {failed.length > 0 && (
          <ul className="mt-3 divide-y divide-ground/5">
            {failed.map((q) => (
              <li key={q.check} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                <span className="text-sm text-ground">{q.check}</span>
                <span className="text-sm text-state-support">
                  <span aria-hidden>▲</span> expected {q.expected}, found {q.actual}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Callout tone="info" label="Resetting is not on this screen">
        <p className="measure">
          The reset control lives on the demo administration console, where it takes a typed
          reason and writes an audit entry, and only a demo administrator can reach it. A second
          copy of a control that deletes every row — on a screen most of whose readers cannot
          use it — would make this environment easier to destroy and no easier to verify.
        </p>
        <p className="measure mt-2">
          {user.role === "demo_admin" ? (
            <Link href="/admin/demo" className="font-medium text-state-info underline">
              Demo administration
            </Link>
          ) : (
            <>You are signed in as {user.role}, so that console is not open to you.</>
          )}
        </p>
      </Callout>
    </ReviewPage>
  );
}
