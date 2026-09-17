import test from "node:test";
import assert from "node:assert/strict";
import {
  RETURN_COOKIE, DEFAULT_RETURN, rememberable, parseReturn, returnTo,
} from "../src/lib/experience/return-to";

// "Preserve origin, filters, sort, pagination, and scroll on return. Support
// direct links without relying on browser history. Validate return
// destinations against approved internal routes."
//
// The third sentence is the one these tests are mostly about. The stored value
// arrives from a cookie, which is something its holder can write, so every
// assertion below treats it as input rather than as state.

test("a console route with a filtered view is remembered with its filters", () => {
  assert.equal(
    rememberable("/clinician/today", "?filter=immediate&assignedToMe=mine"),
    "/clinician/today?assignedToMe=mine&filter=immediate"
  );
  // One view produces one value however the query was written, and the order
  // is the declared one rather than whatever the caller sent.
  assert.equal(
    rememberable("/clinician/today", "?assignedToMe=mine&filter=immediate"),
    rememberable("/clinician/today", "?filter=immediate&assignedToMe=mine")
  );
});

test("a console route with no view state is remembered as its bare path", () => {
  assert.equal(rememberable("/clinician/caseload", ""), "/clinician/caseload");
});

test("a person record is not somewhere to come back to", () => {
  // Otherwise the return control would point at the record the reader is
  // already inside, or at the last person they opened.
  assert.equal(rememberable("/clinician/member/p-1", ""), null);
  assert.equal(rememberable("/clinician/member/p-1/course", ""), null);
  assert.equal(rememberable("/app/today", ""), null);
  assert.equal(rememberable("/login", ""), null);
});

test("a person id is never written to the cookie", () => {
  // /clinician/today?row=<id> selects whose evidence the queue has open. The
  // return control does not need it — the reader is coming back FROM that
  // person — and it is an identifier in browser storage to save one click.
  const stored = rememberable("/clinician/today", "?filter=immediate&row=PERSON-123");
  assert.ok(stored);
  assert.ok(!stored!.includes("PERSON-123"), `the person id survived: ${stored}`);
  assert.ok(!stored!.includes("row"), `the row parameter survived: ${stored}`);
});

test("free text a clinician typed is never written to the cookie", () => {
  // Patient search is free text and in this product it is usually a name.
  const stored = rememberable("/clinician/patients", "?q=Idowu");
  assert.equal(stored, "/clinician/patients");
});

test("flash state is not carried back", () => {
  // Carrying `done` back would re-show "handoff accepted" on a screen where
  // nothing had just happened: a result message that is no longer true.
  assert.equal(rememberable("/clinician/handoffs", "?done=1&refused=2"), "/clinician/handoffs");
  assert.equal(rememberable("/clinician/caseload", "?error=nope"), "/clinician/caseload");
});

test("a stored value resolves to its console and its own label", () => {
  const back = parseReturn("/clinician/patients");
  assert.deepEqual(back, { href: "/clinician/patients", label: "Back to Patients" });

  const filtered = parseReturn("/clinician/today?filter=immediate");
  assert.deepEqual(filtered, {
    href: "/clinician/today?filter=immediate",
    label: "Back to Command Center",
  });
});

test("a destination outside the approved set is refused, not repaired", () => {
  for (const hostile of [
    "https://evil.example/steal",
    "//evil.example/steal",
    "http://localhost:3000/clinician/today",
    "/clinician/member/p-1",
    "/../../etc/passwd",
    "/clinician/today/../../admin/demo",
    "/clinician/today/..",
    "/clinician/todayX",
    "javascript:alert(1)",
    "",
    "not-a-path",
  ]) {
    assert.equal(parseReturn(hostile), null, `${hostile} was accepted`);
  }
});

test("whatever comes back, it is one of the four approved consoles", () => {
  // THE INVARIANT, asserted on the output rather than on the guards. There is
  // no pre-check in front of the allowlist any more, because every value those
  // checks refused fails the allowlist too and mutation testing could not tell
  // them from their absence. This is what actually has to hold.
  const APPROVED = [
    "/clinician/today", "/clinician/patients",
    "/clinician/caseload", "/clinician/handoffs",
  ];
  const inputs = [
    "https://evil.example/steal", "//evil.example", "/clinician/today/../admin",
    "/clinician/today?next=https://evil.example", "/clinician/patients?q=Idowu",
    "/clinician/today?filter=immediate", "/clinician/handoffs", "/admin/demo",
    "/clinician/today#/../evil", "/clinician/today%2f..%2fadmin", "  /clinician/today",
  ];
  for (const raw of inputs) {
    const href = returnTo(raw).href;
    const [path] = href.split("?");
    assert.ok(
      APPROVED.includes(path),
      `${raw} produced ${href}, whose path is not one of the four consoles`
    );
  }
});

test("a parameter smuggled into a stored value is dropped on the way out", () => {
  // The href is REBUILT from the allowlist rather than echoed, so a cookie
  // edited by hand produces one of four destinations with a subset of known
  // parameters, or nothing.
  const back = parseReturn("/clinician/today?filter=immediate&row=PERSON-123&q=Idowu&next=//evil");
  assert.ok(back);
  assert.equal(back!.href, "/clinician/today?filter=immediate");
});

test("a record opened from a direct link still has somewhere to go", () => {
  // "Support direct links without relying on browser history." No cookie is
  // the normal case for a link pasted into a message.
  assert.deepEqual(returnTo(undefined), DEFAULT_RETURN);
  assert.deepEqual(returnTo(null), DEFAULT_RETURN);
  assert.deepEqual(returnTo("https://evil.example"), DEFAULT_RETURN);
  assert.equal(DEFAULT_RETURN.href, "/clinician/today");
});

test("the cookie name is stable", () => {
  // Named here so a rename has to be deliberate: the proxy writes it and the
  // person shell reads it, and they are in different layers.
  assert.equal(RETURN_COOKIE, "steady_return");
});
