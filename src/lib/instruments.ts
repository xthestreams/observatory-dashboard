/**
 * Instrument helper functions for auto-registration and type inference
 */

import { SupabaseClient } from "@supabase/supabase-js";
import {
  IngestPayload,
  InstrumentType,
  Instrument,
  InstrumentReading,
  FailedInstrument,
  InstrumentStatus,
} from "@/types/weather";

/**
 * Get or create an instrument by code, auto-registering if needed
 */
export async function getOrCreateInstrument(
  supabase: SupabaseClient,
  code: string,
  data: IngestPayload
): Promise<string> {
  // Try to find existing instrument
  const { data: existing, error: findError } = await supabase
    .from("instruments")
    .select("id")
    .eq("code", code)
    .single();

  if (existing && !findError) {
    return existing.id;
  }

  // Auto-register new instrument
  const type = inferInstrumentType(data);
  const capabilities = inferCapabilities(data);

  const { data: created, error: createError } = await supabase
    .from("instruments")
    .insert({
      code,
      name: code, // Can be updated later via admin
      instrument_type: type,
      capabilities,
      include_in_average: true,
      priority: 0,
      status: "active",
    })
    .select("id")
    .single();

  if (createError) {
    // Handle race condition - another request might have created it
    if (createError.code === "23505") {
      // Unique violation
      const { data: retry } = await supabase
        .from("instruments")
        .select("id")
        .eq("code", code)
        .single();
      if (retry) return retry.id;
    }
    throw createError;
  }

  return created.id;
}

/**
 * Infer instrument type from the data fields present
 */
export function inferInstrumentType(data: IngestPayload): InstrumentType {
  // SQM if sky_quality is present
  if (data.sky_quality !== undefined) {
    return "sqm";
  }

  // Cloudwatcher if sky/ambient temp or cloud conditions present
  if (
    data.cloud_condition !== undefined ||
    data.sky_temp !== undefined ||
    data.ambient_temp !== undefined
  ) {
    // But not if it also has weather station fields
    if (
      data.temperature === undefined &&
      data.humidity === undefined &&
      data.pressure === undefined
    ) {
      return "cloudwatcher";
    }
  }

  // Weather station if temp/humidity/pressure present
  if (
    data.temperature !== undefined ||
    data.humidity !== undefined ||
    data.pressure !== undefined ||
    data.wind_speed !== undefined
  ) {
    return "weather_station";
  }

  return "unknown";
}

/**
 * Infer capabilities from the data fields present
 */
export function inferCapabilities(data: IngestPayload): string[] {
  const caps: string[] = [];

  if (data.temperature !== undefined) caps.push("temperature");
  if (data.humidity !== undefined) caps.push("humidity");
  if (data.pressure !== undefined) caps.push("pressure");
  if (data.dewpoint !== undefined) caps.push("dewpoint");
  if (data.wind_speed !== undefined) caps.push("wind_speed");
  if (data.wind_gust !== undefined) caps.push("wind_gust");
  if (data.wind_direction !== undefined) caps.push("wind_direction");
  if (data.rain_rate !== undefined) caps.push("rain_rate");
  if (data.sky_temp !== undefined) caps.push("sky_temp");
  if (data.ambient_temp !== undefined) caps.push("ambient_temp");
  if (data.sky_quality !== undefined) caps.push("sky_quality");
  if (data.sqm_temperature !== undefined) caps.push("sqm_temperature");
  if (data.cloud_condition !== undefined) caps.push("cloud_condition");
  if (data.rain_condition !== undefined) caps.push("rain_condition");
  if (data.wind_condition !== undefined) caps.push("wind_condition");
  if (data.day_condition !== undefined) caps.push("day_condition");

  return caps;
}

/**
 * Fetch all instruments from the database
 */
export async function fetchInstruments(
  supabase: SupabaseClient
): Promise<Instrument[]> {
  const { data, error } = await supabase
    .from("instruments")
    .select("*")
    .order("priority", { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Fetch failed instruments (degraded or offline)
 */
export async function fetchFailedInstruments(
  supabase: SupabaseClient
): Promise<FailedInstrument[]> {
  const { data, error } = await supabase
    .from("instruments")
    .select("code, name, status, last_reading_at, consecutive_outliers")
    .in("status", ["degraded", "offline"])
    .order("status", { ascending: true }); // offline first

  if (error) throw error;

  return (data || []).map((i) => ({
    code: i.code,
    name: i.name,
    status: i.status as "degraded" | "offline",
    lastReadingAt: i.last_reading_at,
    consecutiveOutliers: i.consecutive_outliers,
  }));
}

/**
 * Compute effective status based on last reading time
 * Instruments that haven't reported recently are considered offline
 */
function computeEffectiveStatus(
  dbStatus: string,
  lastReadingAt: string | null
): InstrumentStatus {
  // If already offline or maintenance, keep that status
  if (dbStatus === "offline" || dbStatus === "maintenance") {
    return dbStatus as InstrumentStatus;
  }

  // Check if the instrument has gone stale (no data in last 15 minutes)
  if (lastReadingAt) {
    const lastReading = new Date(lastReadingAt).getTime();
    const now = Date.now();
    const staleThresholdMs = 15 * 60 * 1000; // 15 minutes

    if (now - lastReading > staleThresholdMs) {
      return "offline";
    }
  } else {
    // No readings ever recorded - consider offline
    return "offline";
  }

  return dbStatus as InstrumentStatus;
}

/**
 * Fetch latest reading for each instrument
 */
export async function fetchLatestInstrumentReadings(
  supabase: SupabaseClient
): Promise<Record<string, InstrumentReading>> {
  // Get all instruments with their latest reading
  const { data: instruments, error: instError } = await supabase
    .from("instruments")
    .select("*");

  if (instError) {
    console.error("Error fetching instruments:", instError);
    throw instError;
  }

  console.log("Found instruments:", instruments?.length || 0);

  const readings: Record<string, InstrumentReading> = {};

  // For each instrument, get its latest reading
  for (const inst of instruments || []) {
    const { data: readingArray } = await supabase
      .from("instrument_readings")
      .select("*")
      .eq("instrument_id", inst.id)
      .order("created_at", { ascending: false })
      .limit(1);

    const reading = readingArray?.[0];
    if (reading) {
      // Compute effective status based on staleness
      const effectiveStatus = computeEffectiveStatus(
        inst.status,
        reading.created_at
      );

      readings[inst.code] = {
        instrumentId: inst.id,
        instrumentCode: inst.code,
        instrumentName: inst.name,
        instrumentType: inst.instrument_type as InstrumentType,
        status: effectiveStatus,
        isOutlier: reading.is_outlier,
        outlierReason: reading.outlier_reason,
        lastReadingAt: reading.created_at,
        temperature: reading.temperature,
        humidity: reading.humidity,
        pressure: reading.pressure,
        dewpoint: reading.dewpoint,
        wind_speed: reading.wind_speed,
        wind_gust: reading.wind_gust,
        wind_direction: reading.wind_direction,
        rain_rate: reading.rain_rate,
        sky_temp: reading.sky_temp,
        ambient_temp: reading.ambient_temp,
        sky_quality: reading.sky_quality,
        sqm_temperature: reading.sqm_temperature,
        cloud_condition: reading.cloud_condition,
        rain_condition: reading.rain_condition,
        wind_condition: reading.wind_condition,
        day_condition: reading.day_condition,
      };
    }
  }

  return readings;
}

/**
 * Get instruments that measure a specific metric
 */
export function getInstrumentsForMetric(
  readings: Record<string, InstrumentReading>,
  metric: string
): InstrumentReading[] {
  return Object.values(readings).filter((reading) => {
    const value = reading[metric as keyof InstrumentReading];
    return value !== undefined && value !== null;
  });
}

/**
 * Count how many ACTIVE instruments measure a specific metric
 * (excludes offline, degraded, and maintenance instruments)
 */
export function countInstrumentsForMetric(
  readings: Record<string, InstrumentReading>,
  metric: string
): number {
  return getInstrumentsForMetric(readings, metric).filter(
    (r) => r.status === "active"
  ).length;
}

/**
 * Format relative time for last reading
 */
export function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "Never";

  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Get status color for instrument
 */
export function getStatusColor(status: InstrumentStatus): string {
  switch (status) {
    case "active":
      return "var(--color-success, #22c55e)";
    case "degraded":
      return "var(--color-warning, #f59e0b)";
    case "offline":
      return "var(--color-error, #ef4444)";
    case "maintenance":
      return "var(--color-muted, #6b7280)";
    default:
      return "var(--color-muted, #6b7280)";
  }
}

/**
 * Get status icon for instrument
 */
export function getStatusIcon(status: InstrumentStatus): string {
  switch (status) {
    case "active":
      return "●";
    case "degraded":
      return "◐";
    case "offline":
      return "○";
    case "maintenance":
      return "◌";
    default:
      return "?";
  }
}
