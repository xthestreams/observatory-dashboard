import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase";
import { getOrCreateInstrument } from "@/lib/instruments";
import { createLogger } from "@/lib/logger";
import { validateIngestKey } from "@/lib/api-auth";
import { IngestPayloadSchema, formatZodError } from "@/lib/validation";
import {
  BadRequestError,
  UnauthorizedError,
  errorResponse,
  generateRequestId,
} from "@/lib/api-errors";

const logger = createLogger("api/ingest/data");

export async function POST(request: NextRequest) {
  const requestId = generateRequestId();

  // Verify API key from Raspberry Pi
  const authHeader = request.headers.get("Authorization");

  if (!validateIngestKey(authHeader)) {
    logger.warn("Unauthorized ingest attempt", { requestId });
    return errorResponse(new UnauthorizedError(), requestId);
  }

  try {
    const rawData = await request.json();

    // Validate payload with Zod
    const parseResult = IngestPayloadSchema.safeParse(rawData);
    if (!parseResult.success) {
      logger.warn("Invalid ingest payload", {
        requestId,
        errors: parseResult.error.issues.length,
      });
      return errorResponse(
        new BadRequestError("Validation error", formatZodError(parseResult.error)),
        requestId
      );
    }

    const data = parseResult.data;
    const supabase = createServiceClient();
    const timestamp = new Date().toISOString();

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

    if (readingError) {
      logger.error("Error inserting instrument reading", readingError, {
        requestId,
        instrumentCode,
      });
      return NextResponse.json(
        { error: "Failed to insert instrument reading" },
        { status: 500 }
      );
    }

    // Update the instrument's last_reading_at timestamp
    const { data: updateResult, error: updateError } = await supabase
      .from("instruments")
      .update({ last_reading_at: timestamp, updated_at: timestamp })
      .eq("id", instrumentId)
      .select("id, code, last_reading_at");

    if (updateError) {
      logger.error("Error updating instrument last_reading_at", updateError, {
        requestId,
        instrumentCode,
        instrumentId,
      });
    } else if (!updateResult || updateResult.length === 0) {
      logger.warn("No rows updated for instrument", {
        requestId,
        instrumentCode,
        instrumentId,
      });
    }

    // BACKWARD COMPATIBILITY: Also update legacy tables
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
      logger.warn("Error updating legacy current_conditions", { requestId, error: currentError.message });
    }

    // Also insert into historical readings - legacy table
    const { error: historyError } = await supabase
      .from("weather_readings")
      .insert({ ...legacyRecord, created_at: timestamp });

    if (historyError) {
      logger.warn("Error inserting legacy weather_readings", { requestId, error: historyError.message });
    }

    logger.info("Ingest successful", {
      requestId,
      instrumentCode,
      hasTemperature: data.temperature != null,
      hasSkyQuality: data.sky_quality != null,
    });

    return NextResponse.json({
      success: true,
      timestamp,
      instrument: instrumentCode,
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        new BadRequestError("Validation error", formatZodError(error)),
        requestId
      );
    }

    logger.error("Ingest error", error, { requestId });
    return errorResponse(error, requestId);
  }
}
