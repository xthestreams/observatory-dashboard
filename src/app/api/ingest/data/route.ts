import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { getOrCreateInstrument, inferInstrumentType } from "@/lib/instruments";
import { updateInstrumentReading, ReadingValues } from "@/lib/telemetryKV";
import { IngestPayload } from "@/types/weather";

export async function POST(request: NextRequest) {
  // Verify API key from Raspberry Pi
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const data: IngestPayload = await request.json();
    const timestamp = new Date().toISOString();

    // Validate payload
    if (typeof data !== "object" || data === null) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Get instrument code (default if not provided for backward compatibility)
    const instrumentCode = data.instrument_code || "default";

    // Get or create the instrument (auto-registration)
    const instrumentId = await getOrCreateInstrument(supabase, instrumentCode, data);

    // Prepare the reading record
    const readingRecord = {
      instrument_id: instrumentId,
      temperature: data.temperature ?? null,
      humidity: data.humidity ?? null,
      pressure: data.pressure ?? null,
      dewpoint: data.dewpoint ?? null,
      wind_speed: data.wind_speed ?? null,
      wind_gust: data.wind_gust ?? null,
      wind_direction: data.wind_direction ?? null,
      rain_rate: data.rain_rate ?? null,
      cloud_condition: data.cloud_condition ?? null,
      rain_condition: data.rain_condition ?? null,
      wind_condition: data.wind_condition ?? null,
      day_condition: data.day_condition ?? null,
      sky_temp: data.sky_temp ?? null,
      ambient_temp: data.ambient_temp ?? null,
      sky_quality: data.sky_quality ?? null,
      sqm_temperature: data.sqm_temperature ?? null,
      is_outlier: false, // Will be updated by trigger/function if needed
      created_at: timestamp,
    };

    // Insert into instrument_readings (new multi-instrument table)
    const { error: readingError } = await supabase
      .from("instrument_readings")
      .insert(readingRecord);

    // Prepare reading values for in-memory state
    const readingValues: ReadingValues = {
      temperature: data.temperature ?? null,
      humidity: data.humidity ?? null,
      pressure: data.pressure ?? null,
      dewpoint: data.dewpoint ?? null,
      wind_speed: data.wind_speed ?? null,
      wind_gust: data.wind_gust ?? null,
      wind_direction: data.wind_direction ?? null,
      rain_rate: data.rain_rate ?? null,
      sky_temp: data.sky_temp ?? null,
      ambient_temp: data.ambient_temp ?? null,
      sky_quality: data.sky_quality ?? null,
      sqm_temperature: data.sqm_temperature ?? null,
      cloud_condition: data.cloud_condition ?? null,
      rain_condition: data.rain_condition ?? null,
      wind_condition: data.wind_condition ?? null,
      day_condition: data.day_condition ?? null,
    };

    // Infer instrument type for in-memory state
    const instrumentType = inferInstrumentType(data);

    if (readingError) {
      console.error("Error inserting instrument reading:", readingError);
      // Still update KV state so dashboard can show data even when Supabase is blocked
      await updateInstrumentReading(instrumentCode, instrumentCode, instrumentType, readingValues, false);
      return NextResponse.json(
        { error: "Failed to insert instrument reading" },
        { status: 500 }
      );
    }

    // Update KV telemetry state (for health checks and data display without Supabase)
    await updateInstrumentReading(instrumentCode, instrumentCode, instrumentType, readingValues, readingRecord.is_outlier);

    // Update the instrument's last_reading_at timestamp
    const { error: updateError } = await supabase
      .from("instruments")
      .update({ last_reading_at: timestamp, updated_at: timestamp })
      .eq("id", instrumentId);

    if (updateError) {
      console.error("Error updating instrument last_reading_at:", updateError);
      // Don't fail the request - the reading was stored successfully
    }

    // BACKWARD COMPATIBILITY: Also update legacy tables
    // This allows gradual migration and easy rollback
    const legacyRecord = {
      temperature: data.temperature ?? null,
      humidity: data.humidity ?? null,
      pressure: data.pressure ?? null,
      dewpoint: data.dewpoint ?? null,
      wind_speed: data.wind_speed ?? null,
      wind_gust: data.wind_gust ?? null,
      wind_direction: data.wind_direction ?? null,
      rain_rate: data.rain_rate ?? null,
      cloud_condition: data.cloud_condition ?? "Unknown",
      rain_condition: data.rain_condition ?? "Unknown",
      wind_condition: data.wind_condition ?? "Unknown",
      day_condition: data.day_condition ?? "Unknown",
      sky_temp: data.sky_temp ?? null,
      ambient_temp: data.ambient_temp ?? null,
      sky_quality: data.sky_quality ?? null,
      sqm_temperature: data.sqm_temperature ?? null,
      lora_sensors: data.lora_sensors ?? null,
      updated_at: timestamp,
    };

    // Update current conditions (upsert) - legacy table
    const { error: currentError } = await supabase
      .from("current_conditions")
      .upsert({ id: 1, ...legacyRecord });

    if (currentError) {
      console.error("Error updating current conditions:", currentError);
      // Don't fail the request - new table is the source of truth
    }

    // Also insert into historical readings - legacy table
    const { error: historyError } = await supabase
      .from("weather_readings")
      .insert({ ...legacyRecord, created_at: timestamp });

    if (historyError) {
      console.error("Error inserting historical reading:", historyError);
      // Don't fail the request - new table is the source of truth
    }

    return NextResponse.json({
      success: true,
      timestamp,
      instrument: instrumentCode,
    });
  } catch (error) {
    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
