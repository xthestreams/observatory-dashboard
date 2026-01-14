import { NextRequest, NextResponse } from "next/server";
import { updateHeartbeat, getTelemetryHealth, getDebugState } from "@/lib/telemetryKV";

export const dynamic = "force-dynamic";

interface HeartbeatPayload {
  instruments: string[];  // List of instrument codes the collector is monitoring
  collector_version?: string;
  uptime_seconds?: number;
}

/**
 * POST /api/heartbeat
 * Receives heartbeat from Pi collector to indicate it's alive and what instruments it's monitoring.
 * Updates Vercel KV state (no Supabase needed for health checks).
 *
 * This allows us to distinguish:
 * - Collector down (no heartbeat)
 * - Data flow blocked (heartbeat OK but no readings)
 * - All working (heartbeat OK and readings OK)
 */
export async function POST(request: NextRequest) {
  // Verify API key from Raspberry Pi
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const data: HeartbeatPayload = await request.json();
    const timestamp = new Date().toISOString();

    // Validate payload
    if (!Array.isArray(data.instruments)) {
      return NextResponse.json(
        { error: "Invalid payload: instruments must be an array" },
        { status: 400 }
      );
    }

    // Update KV state (primary source of truth for health)
    await updateHeartbeat({
      instruments: data.instruments,
      collector_version: data.collector_version,
      uptime_seconds: data.uptime_seconds,
    });

    return NextResponse.json({
      success: true,
      timestamp,
      acknowledged_instruments: data.instruments.length,
    });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/heartbeat
 * Returns the current telemetry health from KV state
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "true";

  if (debug) {
    // Return raw state for debugging
    return NextResponse.json(await getDebugState());
  }

  // Return computed health status
  const health = await getTelemetryHealth();

  return NextResponse.json({
    status: health.collectorHeartbeat?.status || "unknown",
    lastHeartbeat: health.collectorHeartbeat?.lastHeartbeat,
    instruments: health.collectorHeartbeat?.instruments || [],
    collectorVersion: health.collectorHeartbeat?.collectorVersion,
    uptimeSeconds: health.collectorHeartbeat?.uptimeSeconds,
    ageMs: health.collectorHeartbeat?.ageMs,
  });
}
