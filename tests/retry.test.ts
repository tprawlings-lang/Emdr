import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, isTransientHttpError } from "../src/lib/retry.ts";

const noSleep = async () => {};
const fixedRandom = () => 0; // deterministic backoff

test("succeeds on the first try without sleeping", async () => {
  let sleeps = 0;
  const out = await withRetry(async () => "ok", {
    sleep: async () => {
      sleeps++;
    },
    random: fixedRandom,
  });
  assert.equal(out, "ok");
  assert.equal(sleeps, 0);
});

test("retries then succeeds", async () => {
  let calls = 0;
  const out = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return calls;
    },
    { attempts: 5, sleep: noSleep, random: fixedRandom }
  );
  assert.equal(out, 3);
  assert.equal(calls, 3);
});

test("throws the last error after exhausting attempts", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw new Error(`fail-${calls}`);
      },
      { attempts: 3, sleep: noSleep, random: fixedRandom }
    ),
    /fail-3/
  );
  assert.equal(calls, 3);
});

test("stops immediately when shouldRetry returns false", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        const e = new Error("permanent") as Error & { status?: number };
        e.status = 400;
        throw e;
      },
      { attempts: 5, sleep: noSleep, random: fixedRandom, shouldRetry: isTransientHttpError }
    ),
    /permanent/
  );
  assert.equal(calls, 1); // 400 is not transient → no retry
});

test("isTransientHttpError classifies statuses", () => {
  assert.equal(isTransientHttpError(new Error("network")), true); // no status
  assert.equal(isTransientHttpError({ status: 429 }), true);
  assert.equal(isTransientHttpError({ status: 503 }), true);
  assert.equal(isTransientHttpError({ status: 500 }), true);
  assert.equal(isTransientHttpError({ status: 400 }), false);
  assert.equal(isTransientHttpError({ status: 404 }), false);
  assert.equal(isTransientHttpError({ status: 200 }), false);
});

test("backoff is capped by maxMs", async () => {
  const delays: number[] = [];
  await assert.rejects(
    withRetry(
      async () => {
        throw new Error("x");
      },
      {
        attempts: 6,
        baseMs: 1000,
        maxMs: 2000,
        random: () => 1, // upper jitter bound → delay === backoff
        sleep: async (ms) => {
          delays.push(ms);
        },
      }
    )
  );
  // baseMs*2^n would be 1000,2000,4000,... but capped at 2000.
  assert.ok(Math.max(...delays) <= 2000, `max delay ${Math.max(...delays)} exceeded cap`);
});
