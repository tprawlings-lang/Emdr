// Tenant-aware, re-entrant transactions (ADR 0013 §3 and §5).
//
// Three properties are asserted here, each of which was a latent defect before
// this work:
//
//   AMBIENT   — a write issued through `data()` inside a transaction must be
//               part of that transaction. It previously executed on the pool,
//               outside the transaction, and survived a rollback on Postgres.
//
//   RE-ENTRANT — a nested `tx()` must become a savepoint on the same
//               connection. It previously issued a bare BEGIN/COMMIT, so an
//               inner helper committed the outer command's work early.
//
//   TENANT-BOUND — a transaction carries exactly one tenant, and a nested call
//               naming a different one is an error rather than a silent
//               cross-tenant write.
//
// The SQLite backend is what runs here. The Postgres-specific half — that
// `set_config('app.tenant_id', ..., true)` actually engages the RLS policies —
// is proven against a real cluster by scripts/verify-rls.sh, which is
// CI-blocking. Neither test subsumes the other.
//
// Hermetic temp DB.
process.env.EMDR_DATA_DIR = `/tmp/steady-tenanttx-${process.pid}-${Date.now()}`;
delete process.env.EMDR_DEMO;

import { strict as assert } from "node:assert";
import test from "node:test";
import { data } from "../src/lib/data";
import { newId, PLATFORM_TENANT_ID } from "../src/lib/db";
import { withTenantTransaction, boundTenantId, repo } from "../src/lib/repository";
import { createTenant, createPerson, platformContext } from "../src/lib/tenancy";
import { appendEvent, readEvents } from "../src/lib/events";
import { applyProjection } from "../src/lib/projections";
import { provisionPerson } from "../src/lib/spine";

const USER = "ttx-user";
let orgA = "";

test("setup", async () => {
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
    [USER, "ttx@test.local", "Tenant Tx", "member", "x"]);
  await provisionPerson({ userId: USER, name: "Tenant Tx", email: "ttx@test.local", role: "member" });
  orgA = await createTenant({ kind: "organization", name: "Alpha" });
  assert.ok(orgA);
});

// ---------- Ambient ----------

test("AMBIENT: a write through data() inside a transaction is part of it", async () => {
  const c = await data();
  const id = newId();

  await assert.rejects(async () => {
    await c.tx(async () => {
      // Deliberately NOT using the client the callback was handed — this is
      // what every helper in the codebase does.
      const ambient = await data();
      await ambient.run(
        `INSERT INTO lesson_reads (id, user_id, lesson_id) VALUES (?, ?, 'ambient-test')`,
        [id, USER]
      );
      throw new Error("boom");
    });
  }, /boom/);

  const row = await c.get("SELECT id FROM lesson_reads WHERE id = ?", [id]);
  assert.equal(row, undefined, "the rollback took the ambient write with it");
});

// ---------- Re-entrancy ----------

test("RE-ENTRANT: a nested transaction does not commit the outer one early", async () => {
  const c = await data();
  const outer = newId(), inner = newId();

  await assert.rejects(async () => {
    await c.tx(async () => {
      const d = await data();
      await d.run(`INSERT INTO lesson_reads (id, user_id, lesson_id) VALUES (?, ?, 'outer')`, [outer, USER]);

      // A helper that opens its own transaction. Under the old bare-BEGIN
      // implementation its COMMIT ended the OUTER transaction, making
      // everything above permanent regardless of what happened next.
      await d.tx(async () => {
        await d.run(`INSERT INTO lesson_reads (id, user_id, lesson_id) VALUES (?, ?, 'inner')`, [inner, USER]);
      });

      throw new Error("outer fails after the inner one succeeded");
    });
  }, /outer fails/);

  assert.equal(await c.get("SELECT id FROM lesson_reads WHERE id = ?", [outer]), undefined);
  assert.equal(await c.get("SELECT id FROM lesson_reads WHERE id = ?", [inner]), undefined,
    "the inner transaction's work rolls back with the outer one");
});

test("RE-ENTRANT: an inner failure rolls back to the savepoint, not the whole command", async () => {
  const c = await data();
  const kept = newId(), discarded = newId();

  await c.tx(async () => {
    const d = await data();
    await d.run(`INSERT INTO lesson_reads (id, user_id, lesson_id) VALUES (?, ?, 'kept')`, [kept, USER]);

    // An optional step that is allowed to fail without losing the command.
    await d.tx(async () => {
      await d.run(`INSERT INTO lesson_reads (id, user_id, lesson_id) VALUES (?, ?, 'discarded')`, [discarded, USER]);
      throw new Error("optional step failed");
    }).catch(() => { /* deliberately tolerated */ });

    await d.run(`UPDATE lesson_reads SET lesson_id = 'kept-and-updated' WHERE id = ?`, [kept]);
  });

  const row = (await c.get("SELECT lesson_id FROM lesson_reads WHERE id = ?", [kept])) as { lesson_id: string };
  assert.equal(row?.lesson_id, "kept-and-updated", "the outer transaction survived and committed");
  assert.equal(await c.get("SELECT id FROM lesson_reads WHERE id = ?", [discarded]), undefined,
    "only the savepoint's work was discarded");
});

// ---------- Tenant binding ----------

test("a transaction is bound to exactly one tenant", async () => {
  assert.equal(boundTenantId(), undefined, "no binding outside a transaction");

  await withTenantTransaction({ tenantId: orgA }, async () => {
    assert.equal(boundTenantId(), orgA, "the frame records the tenant it is bound to");
    // Re-entering with the SAME tenant is normal: a command calls helpers.
    await withTenantTransaction({ tenantId: orgA }, async () => {
      assert.equal(boundTenantId(), orgA);
    });
  });

  assert.equal(boundTenantId(), undefined, "the binding does not outlive the transaction");
});

test("ATTACK: a nested call naming a different tenant is refused", async () => {
  await assert.rejects(
    () => withTenantTransaction({ tenantId: orgA }, async () => {
      await withTenantTransaction({ tenantId: PLATFORM_TENANT_ID }, async () => {
        throw new Error("this body must never run");
      });
    }),
    /may not span tenants/,
    "silently honouring the outer tenant would be a cross-tenant write in disguise"
  );
});

test("a transaction cannot be opened without a tenant context", async () => {
  await assert.rejects(
    () => withTenantTransaction({ tenantId: "" }, async () => undefined),
    /Tenant context is required/
  );
});

test("the repository works inside a tenant transaction and stays scoped", async () => {
  const person = "ttx-scoped";
  const c = await data();
  await c.run("INSERT INTO users (id, email, name, role, password_hash, tenant_id) VALUES (?, ?, ?, ?, ?, ?)",
    [person, "scoped@test.local", "Scoped", "member", "x", orgA]);
  await createPerson({ tenantId: orgA, displayName: "Scoped", id: person });

  const id = newId();
  await withTenantTransaction({ tenantId: orgA }, async () => {
    await repo({ tenantId: orgA }).insert("lesson_reads", {
      id, user_id: person, lesson_id: "in-transaction",
    });
  });

  assert.ok(await repo({ tenantId: orgA }).findOne("lesson_reads", "id = ?", [id]));
  assert.equal(await repo(platformContext()).findOne("lesson_reads", "id = ?", [id]), null,
    "written into the transaction's tenant, invisible to another");
});

// ---------- Event + projection atomicity (ADR 0013 §3) ----------

test("ATOMIC: an event and the row it produces commit together", async () => {
  const c = await data();
  const readId = newId();

  await withTenantTransaction({ tenantId: PLATFORM_TENANT_ID }, async (t) => {
    const eventId = await appendEvent({
      personId: USER, type: "lesson.read",
      payload: { projectionId: readId, lessonId: "atomic-commit" },
    });
    const ev = (await readEvents({ personId: USER })).find((e) => e.id === eventId)!;
    assert.equal(await applyProjection(t, ev), true);
  });

  const row = (await c.get("SELECT lesson_id FROM lesson_reads WHERE id = ?", [readId])) as { lesson_id: string };
  assert.equal(row?.lesson_id, "atomic-commit");
  assert.equal(
    (await readEvents({ personId: USER })).filter((e) => e.payload.projectionId === readId).length, 1
  );
});

test("ATOMIC: a projection failure takes the event with it — no orphan history", async () => {
  const c = await data();
  const readId = newId();
  const before = (await readEvents({ personId: USER })).length;

  await assert.rejects(async () => {
    await withTenantTransaction({ tenantId: PLATFORM_TENANT_ID }, async () => {
      await appendEvent({
        personId: USER, type: "lesson.read",
        payload: { projectionId: readId, lessonId: "doomed" },
      });
      throw new Error("projection failed");
    });
  }, /projection failed/);

  assert.equal((await readEvents({ personId: USER })).length, before,
    "an event whose command failed is not history — it never happened");
  assert.equal(await c.get("SELECT id FROM lesson_reads WHERE id = ?", [readId]), undefined);
});

test("an event with no projectionId fails the command rather than inventing one", async () => {
  const c = await data();
  await assert.rejects(async () => {
    await withTenantTransaction({ tenantId: PLATFORM_TENANT_ID }, async (t) => {
      const eventId = await appendEvent({
        personId: USER, type: "lesson.read", payload: { lessonId: "no-projection-id" },
      });
      const ev = (await readEvents({ personId: USER })).find((e) => e.id === eventId)!;
      await applyProjection(t, ev);
    });
  }, /cannot be identified/);

  const orphan = await c.get(
    "SELECT id FROM lesson_reads WHERE lesson_id = 'no-projection-id'", []
  );
  assert.equal(orphan, undefined);
});

test("an event type with no projector reports so rather than failing", async () => {
  await withTenantTransaction({ tenantId: PLATFORM_TENANT_ID }, async (t) => {
    const eventId = await appendEvent({
      personId: USER, type: "memory.recorded",
      payload: { memoryType: "grounding_tool", key: "k", source: "user_message" },
    });
    const ev = (await readEvents({ personId: USER })).find((e) => e.id === eventId)!;
    assert.equal(await applyProjection(t, ev), false,
      "memory is deliberately not a projection — that is not an error");
  });
});
