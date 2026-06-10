import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { aiCompanionEnabled } from "@/lib/companion-ai";

// Operational health check for the AI companion: reports whether an
// ANTHROPIC_API_KEY is configured and whether a minimal test call succeeds.
// Exposes no secrets and no member data. Result is cached briefly so the
// endpoint cannot be used to rack up API spend.

export const dynamic = "force-dynamic";

interface Status {
  keyPresent: boolean;
  api: "ok" | "auth_error" | "billing_error" | "rate_limited" | "error" | "skipped";
  model: string;
  detail: string;
  checkedAt: string;
}

let cached: Status | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

async function probe(): Promise<Status> {
  const model = process.env.EMDR_COMPANION_MODEL ?? "claude-opus-4-8";
  const base: Omit<Status, "api" | "detail"> = {
    keyPresent: aiCompanionEnabled(),
    model,
    checkedAt: new Date().toISOString(),
  };
  if (!base.keyPresent) {
    return {
      ...base,
      api: "skipped",
      detail: "ANTHROPIC_API_KEY is not set; companion uses the built-in rules engine.",
    };
  }
  try {
    const client = new Anthropic();
    await client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    return { ...base, api: "ok", detail: "Test call to the Claude API succeeded." };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      const message = typeof err.message === "string" ? err.message : "API error";
      if (err.status === 401) {
        return { ...base, api: "auth_error", detail: `Key rejected (401): ${message}` };
      }
      if (err.status === 429) {
        return { ...base, api: "rate_limited", detail: `Rate limited (429): ${message}` };
      }
      if (err.status === 400 && /credit|billing/i.test(message)) {
        return { ...base, api: "billing_error", detail: `Key is valid but the account needs credits: ${message}` };
      }
      return { ...base, api: "error", detail: `API error (${err.status}): ${message}` };
    }
    return { ...base, api: "error", detail: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function GET() {
  if (!cached || Date.now() - cachedAt > CACHE_MS) {
    cached = await probe();
    cachedAt = Date.now();
  }
  return NextResponse.json(cached);
}
