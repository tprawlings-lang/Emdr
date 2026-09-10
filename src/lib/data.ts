// Async data-access layer (ADR 0007 step 1). One async interface, two backends:
//
//   - sqlite  (default): wraps the synchronous better-sqlite3 handle from db.ts.
//               Keeps local dev and the test suite fast and server-free.
//   - postgres (EMDR_DB=postgres): node-postgres pool against DATABASE_URL.
//
// Queries are written once with `?` placeholders and `ON CONFLICT` upserts —
// both dialects understand these (the pg backend rewrites `?` → `$n`). Date/
// time values are computed in JS and passed as parameters, so no query relies
// on a backend-specific date function. This lets the whole app move to the
// async API while still running on SQLite until the Postgres cutover.

import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool as PgPool } from "pg";

export type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Ambient transactions (ADR 0013 §3)
// ---------------------------------------------------------------------------
//
// `tx()` used to hand its callback a client and hope every write inside used
// it. Anything that called `data()` instead — which is nearly every helper in
// the codebase — got the POOL, not the transaction. On SQLite that is harmless
// (one connection, so the statement lands inside the open transaction anyway).
// On Postgres it is a silent correctness bug: the write executes on a different
// connection, outside the transaction, and survives a rollback.
//
// That bug has no victims today because only two call sites use `tx()` and both
// thread the client by hand. It would acquire victims the moment an
// authoritative command (ADR 0013 §1) wraps helpers that append events, resolve
// upsert ids, or write memory — which is precisely what step 5 does.
//
// So the transaction is now ambient: `data()` returns the enclosing
// transaction's client when there is one. A nested `tx()` becomes a SAVEPOINT
// on the SAME connection rather than a second transaction on a second
// connection, so partial failure rolls back to the savepoint instead of
// deadlocking or committing early.
interface TxFrame {
  client: DataClient;
  depth: number;
  /** Set by withTenantTransaction; the tenant this transaction is bound to. */
  tenantId?: string;
}

const txStore = new AsyncLocalStorage<TxFrame>();

/** The enclosing transaction, if this code is running inside one. */
export function currentTx(): TxFrame | undefined {
  return txStore.getStore();
}

export interface DataClient {
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export interface Data extends DataClient {
  tx<T>(fn: (c: DataClient) => Promise<T>): Promise<T>;
  backend: "sqlite" | "postgres";
}

/** RENAMED FROM `usePostgres`. In a React codebase a `use` prefix means a
 *  hook, and the linter enforced that meaning by rejecting this file outright —
 *  a plain predicate called from a plain function, flagged as a hook called
 *  outside a component. The rule was right about the name even though it was
 *  wrong about the function: a reader skimming this file had to open it to
 *  learn it was not a hook. */
function postgresConfigured(): boolean {
  return process.env.EMDR_DB === "postgres";
}

// ---- `?` → `$n`, skipping quoted string literals ----------------------------
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      out += c;
      continue;
    }
    if (c === "?") {
      out += `$${++n}`;
      continue;
    }
    out += c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQLite backend — wraps better-sqlite3 (synchronous) behind the async API.
// ---------------------------------------------------------------------------
function sqliteClient(db: import("better-sqlite3").Database): DataClient {
  return {
    async get<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...(params as [])) as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as [])) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const info = db.prepare(sql).run(...(params as []));
      return { changes: info.changes };
    },
  };
}

// ---------------------------------------------------------------------------
// Postgres backend — node-postgres pool.
// ---------------------------------------------------------------------------
function pgClientFromQuery(
  query: (sql: string, params: unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>
): DataClient {
  return {
    async get<T>(sql: string, params: unknown[] = []) {
      const r = await query(toPgPlaceholders(sql), params);
      return r.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[] = []) {
      const r = await query(toPgPlaceholders(sql), params);
      return r.rows as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const r = await query(toPgPlaceholders(sql), params);
      return { changes: r.rowCount ?? 0 };
    },
  };
}

/** Routes every statement to the enclosing transaction when there is one, and
 *  to the pool/handle otherwise. This is what makes `tx()` mean what it says. */
function ambient(base: DataClient): DataClient {
  return {
    get: (sql, params) => (txStore.getStore()?.client ?? base).get(sql, params),
    all: (sql, params) => (txStore.getStore()?.client ?? base).all(sql, params),
    run: (sql, params) => (txStore.getStore()?.client ?? base).run(sql, params),
  };
}

/** Nested `tx()` → savepoint on the same connection. The savepoint SQL is
 *  identical on both backends, so this needs no dialect branch. */
async function nestedTx<T>(frame: TxFrame, fn: (c: DataClient) => Promise<T>): Promise<T> {
  const sp = `steady_sp_${frame.depth}`;
  await frame.client.run(`SAVEPOINT ${sp}`);
  try {
    const out = await txStore.run({ ...frame, depth: frame.depth + 1 }, () => fn(frame.client));
    await frame.client.run(`RELEASE SAVEPOINT ${sp}`);
    return out;
  } catch (e) {
    await frame.client.run(`ROLLBACK TO SAVEPOINT ${sp}`);
    await frame.client.run(`RELEASE SAVEPOINT ${sp}`);
    throw e;
  }
}

let pgPool: PgPool | null = null;
async function getPool(): Promise<PgPool> {
  if (pgPool) return pgPool;
  const { Pool } = await import("pg");
  const connectionString = process.env.DATABASE_URL ?? process.env.EMDR_DATABASE_URL;
  if (!connectionString) throw new Error("EMDR_DB=postgres but DATABASE_URL is not set");
  pgPool = new Pool({
    connectionString,
    max: Number(process.env.EMDR_PG_POOL_MAX ?? 10),
    ssl: /\brender\.com\b/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return pgPool;
}

// ---------------------------------------------------------------------------
// Public handle.
// ---------------------------------------------------------------------------
let cached: Data | null = null;

export async function data(): Promise<Data> {
  if (cached) return cached;

  if (postgresConfigured()) {
    const pool = await getPool();
    const base = pgClientFromQuery((sql, params) => pool.query(sql, params as unknown[]));
    cached = {
      ...ambient(base),
      backend: "postgres",
      async tx<T>(fn: (c: DataClient) => Promise<T>) {
        const open = txStore.getStore();
        if (open) return nestedTx(open, fn);

        const conn = await pool.connect();
        try {
          await conn.query("BEGIN");
          const c = pgClientFromQuery((sql, params) => conn.query(sql, params as unknown[]));
          const out = await txStore.run({ client: c, depth: 1 }, () => fn(c));
          await conn.query("COMMIT");
          return out;
        } catch (e) {
          await conn.query("ROLLBACK");
          throw e;
        } finally {
          // Returning the connection to the pool discards its session state,
          // and `SET LOCAL` reverts at COMMIT/ROLLBACK regardless — so one
          // request's tenant can never leak into the next one's.
          conn.release();
        }
      },
    };
    return cached;
  }

  // SQLite backend (default).
  const { getDb } = await import("./db");
  const db = getDb();
  const base = sqliteClient(db);
  cached = {
    ...ambient(base),
    backend: "sqlite",
    async tx<T>(fn: (c: DataClient) => Promise<T>) {
      const open = txStore.getStore();
      if (open) return nestedTx(open, fn);

      // better-sqlite3 transactions are synchronous; emulate with explicit
      // statements so the async callback can run inside them. One connection,
      // so the frame's client is the same handle everything else uses.
      db.prepare("BEGIN").run();
      try {
        const out = await txStore.run({ client: base, depth: 1 }, () => fn(base));
        db.prepare("COMMIT").run();
        return out;
      } catch (e) {
        db.prepare("ROLLBACK").run();
        throw e;
      }
    },
  };
  return cached;
}

// Test/support hook: drop the cached handle (and close the pool) so a new
// backend/env can be selected.
export async function resetData(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  cached = null;
}
