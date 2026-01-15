import { NextRequest, NextResponse } from "next/server";
import { updateHeartbeat, getTelemetryHealth, getDebugState } from "@/lib/telemetryKV";

export const dynamic = "force-dynamic";

interface InstrumentHealth {
  status: "HEALTHY" | "DEGRADED" | "OFFLINE";
  failure_rate: number;
}

interface PowerStatusPayload {
  status: "good" | "degraded" | "down" | "unknown";
  battery_charge: number | null;
  battery_runtime: number | null;
  input_voltage: number | null;
  output_voltage: number | null;
  ups_status: string | null;
  ups_load: number | null;
  ups_model: string | null;
  last_update: string | null;
}

interface HeartbeatPayload {
  instruments: string[];  // List of instrument codes the collector is monitoring
  instrument_health: Record<string, InstrumentHealth>;  // Health status per instrument
  collector_version?: string;
  uptime_seconds?: number;
  power_status?: PowerStatusPayload | null;  // UPS power status if available
}

/**
 * POST /api/heartbeat
 * Receives heartbeat from Pi collector with instrument health statuses.
 *
 * The collector is the source of truth for instrument health. It tracks
 * success/failure rates and reports:
 * - HEALTHY: < 20% failure rate
 * - DEGRADED: 20-80% failure rate
 * - OFFLINE: > 80% failure rate
 *
 * The server stores this data in KV and the dashboard displays it directly.
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

    // Update KV state with collector-reported health
    await updateHeartbeat({
      instruments: data.instruments,
      instrument_health: data.instrument_health || {},
      collector_version: data.collector_version,
      uptime_seconds: data.uptime_seconds,
      power_status: data.power_status || null,
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
    powerStatus: health.collectorHeartbeat?.powerStatus || null,
  });
}
