import { NextResponse } from "next/server";
import { getTelemetryHealth, getDebugState } from "@/lib/telemetryKV";

export const dynamic = "force-dynamic";

/**
 * GET /api/telemetry-health
 * Returns telemetry health status computed from KV state.
 * No Supabase queries - uses state updated by heartbeat and ingest endpoints.
 *
 * Query params:
 * - debug=true: Return raw state for debugging
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "true";

  if (debug) {
    return NextResponse.json(await getDebugState());
  }

  const health = await getTelemetryHealth();
  return NextResponse.json(health);
}
