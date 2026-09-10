import { NextResponse } from "next/server";
import { probeProvider, providerConfigured, type ProbeStatus } from "@/lib/ai-gateway";

// Operational health check for the AI companion: reports whether an
// ANTHROPIC_API_KEY is configured and whether a minimal test call succeeds.
// Exposes no secrets and no member data. Result is cached briefly so the
// endpoint cannot be used to rack up API spend.

export const dynamic = "force-dynamic";

interface Status {
  keyPresent: boolean;
  api: ProbeStatus;
  model: string;
  detail: string;
  checkedAt: string;
}

let cached: Status | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

async function probe(): Promise<Status> {
  // The provider-specific part of this — which HTTP status means "key
  // rejected" and which means "no credit" — lives behind the gateway's
  // provider boundary. It used to live here, as a fifth direct provider call
  // in a file nobody thinks of as AI code, which is exactly how the boundary
  // erodes.
  const model = process.env.EMDR_COMPANION_MODEL ?? "claude-opus-4-8";
  const result = await probeProvider(model);
  return {
    keyPresent: providerConfigured(),
    model: result.model,
    api: result.status,
    detail: result.detail,
    checkedAt: new Date().toISOString(),
  };
}

export async function GET() {
  if (!cached || Date.now() - cachedAt > CACHE_MS) {
    cached = await probe();
    cachedAt = Date.now();
  }
  return NextResponse.json(cached);
}
