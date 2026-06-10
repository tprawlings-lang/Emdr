import { NextResponse } from "next/server";
import { backupConfigured, readBackupState } from "@/lib/backup";

// Operational visibility for nightly backups: configuration state and the
// last success/failure timestamps. No keys, no data.
export const dynamic = "force-dynamic";

export async function GET() {
  const state = readBackupState();
  return NextResponse.json({
    configured: backupConfigured(),
    lastSuccessAt: state.lastSuccessAt ?? null,
    lastKey: state.lastKey ?? null,
    lastBytes: state.lastBytes ?? null,
    lastFailureAt: state.lastFailureAt ?? null,
    lastError: state.lastError ?? null,
  });
}
