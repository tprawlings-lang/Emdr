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

import type { Pool as PgPool } from "pg";

export type Row = Record<string, unknown>;

export interface DataClient {
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export interface Data extends DataClient {
  tx<T>(fn: (c: DataClient) => Promise<T>): Promise<T>;
  backend: "sqlite" | "postgres";
}

function usePostgres(): boolean {
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

  if (usePostgres()) {
    const pool = await getPool();
    const base = pgClientFromQuery((sql, params) => pool.query(sql, params as unknown[]));
    cached = {
      ...base,
      backend: "postgres",
      async tx<T>(fn: (c: DataClient) => Promise<T>) {
        const conn = await pool.connect();
        try {
          await conn.query("BEGIN");
          const c = pgClientFromQuery((sql, params) => conn.query(sql, params as unknown[]));
          const out = await fn(c);
          await conn.query("COMMIT");
          return out;
        } catch (e) {
          await conn.query("ROLLBACK");
          throw e;
        } finally {
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
    ...base,
    backend: "sqlite",
    async tx<T>(fn: (c: DataClient) => Promise<T>) {
      // better-sqlite3 transactions are synchronous; emulate with explicit
      // statements so the async callback can run inside them.
      db.prepare("BEGIN").run();
      try {
        const out = await fn(base);
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
