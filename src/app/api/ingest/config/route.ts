import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

/**
 * POST /api/ingest/config
 *
 * Receives instrument configuration from the Pi collector.
 * This tells the server which instruments are expected to report data.
 * Instruments not in this list can be marked as "unexpected" or cleaned up.
 */

interface InstrumentConfig {
  code: string;
  type: "sqm" | "weather_station" | "cloudwatcher";
  host: string;
  slot: number;
}

interface ConfigPayload {
  collector_id: string;
  instruments: InstrumentConfig[];
  timestamp: string;
}

export async function POST(request: NextRequest) {
  // Verify API key from Raspberry Pi
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const payload: ConfigPayload = await request.json();

    // Validate payload
    if (!payload.instruments || !Array.isArray(payload.instruments)) {
      return NextResponse.json({ error: "Invalid payload: instruments array required" }, { status: 400 });
    }

    const expectedCodes = payload.instruments.map(i => i.code);
    const timestamp = new Date().toISOString();

    // Mark all instruments from this collector as expected
    for (const inst of payload.instruments) {
      const { error } = await supabase
        .from("instruments")
        .upsert({
          code: inst.code,
          name: inst.code, // Will be auto-updated with proper name on first data
          instrument_type: inst.type,
          capabilities: [], // Will be filled on first data push
          expected: true,
          collector_id: payload.collector_id,
          config: {
            host: inst.host,
            slot: inst.slot,
          },
          updated_at: timestamp,
        }, {
          onConflict: "code",
        });

      if (error) {
        console.error(`Error upserting instrument ${inst.code}:`, error);
      }
    }

    // Mark instruments NOT in this config as not expected
    // This handles cases where:
    // 1. A device was removed from the Pi config (same collector_id)
    // 2. Old ghost entries from other collector_ids need cleanup
    // 3. Test instruments that should be cleaned up
    if (expectedCodes.length > 0) {
      // First, clear expected flag for instruments from THIS collector that aren't in the list
      if (payload.collector_id) {
        const { error: updateError1 } = await supabase
          .from("instruments")
          .update({ expected: false, updated_at: timestamp })
          .eq("collector_id", payload.collector_id)
          .filter("code", "not.in", `(${expectedCodes.join(",")})`);

        if (updateError1) {
          console.error("Error marking removed instruments (same collector):", updateError1);
        }
      }

      // Also mark as not expected any instruments that:
      // 1. Have expected=true
      // 2. Have never received data (last_reading_at is null)
      // 3. Are NOT in the current config list
      // This cleans up ghost entries from test pushes
      const { error: updateError2 } = await supabase
        .from("instruments")
        .update({ expected: false, updated_at: timestamp })
        .eq("expected", true)
        .is("last_reading_at", null)
        .filter("code", "not.in", `(${expectedCodes.join(",")})`);

      if (updateError2) {
        console.error("Error cleaning up ghost instruments:", updateError2);
      }
    }

    // Store the config push timestamp in site_config for dashboard display
    const { error: configError } = await supabase
      .from("site_config")
      .upsert({
        key: "collector_last_config",
        value: {
          collector_id: payload.collector_id,
          instruments: expectedCodes,
          timestamp,
        },
        updated_at: timestamp,
      }, {
        onConflict: "key",
      });

    if (configError) {
      console.error("Error storing config timestamp:", configError);
    }

    return NextResponse.json({
      success: true,
      timestamp,
      instruments_registered: expectedCodes.length,
    });
  } catch (error) {
    console.error("Config ingest error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
