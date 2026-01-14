import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  fetchFailedInstruments,
  fetchLatestInstrumentReadings,
  fetchTelemetryHealth,
} from "@/lib/instruments";
import { WeatherData, HistoricalReading, ApiResponse, CloudCondition, RainCondition, WindCondition, DayCondition } from "@/types/weather";

// Force dynamic rendering - this route fetches live data
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createServiceClient();

    // Fetch latest readings for site conditions aggregation
    // Using direct query instead of view due to potential schema cache issues
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: latestReadings, error: readingsError } = await supabase
      .from("instrument_readings")
      .select(`
        *,
        instruments!inner(code, include_in_average, status)
      `)
      .gte("created_at", tenMinutesAgo)
      .eq("is_outlier", false)
      .eq("instruments.status", "active")
      .eq("instruments.include_in_average", true)
      .order("created_at", { ascending: false });

    // Aggregate the readings into site conditions
    let current: WeatherData | null = null;

    if (latestReadings && latestReadings.length > 0 && !readingsError) {
      // Get the latest reading per instrument
      const latestByInstrument = new Map<string, typeof latestReadings[0]>();
      for (const r of latestReadings) {
        const code = r.instruments?.code;
        if (code && !latestByInstrument.has(code)) {
          latestByInstrument.set(code, r);
        }
      }

      const readings = Array.from(latestByInstrument.values());

      // Calculate averages
      const avg = (arr: (number | null)[]) => {
        const valid = arr.filter((x): x is number => x !== null);
        return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
      };
      const mode = (arr: (string | null)[]) => {
        const valid = arr.filter((x): x is string => x !== null);
        if (valid.length === 0) return null;
        const counts = valid.reduce((acc, v) => {
          acc[v] = (acc[v] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      };

      const temperature = avg(readings.map(r => r.temperature));
      const sky_quality = avg(readings.map(r => r.sky_quality));
      const cloud_condition = mode(readings.map(r => r.cloud_condition));

      current = {
        temperature: temperature !== null ? Math.round(temperature * 10) / 10 : null,
        humidity: avg(readings.map(r => r.humidity)) !== null ? Math.round(avg(readings.map(r => r.humidity))!) : null,
        pressure: avg(readings.map(r => r.pressure)) !== null ? Math.round(avg(readings.map(r => r.pressure))! * 10) / 10 : null,
        dewpoint: avg(readings.map(r => r.dewpoint)) !== null ? Math.round(avg(readings.map(r => r.dewpoint))! * 10) / 10 : null,
        wind_speed: avg(readings.map(r => r.wind_speed)) !== null ? Math.round(avg(readings.map(r => r.wind_speed))! * 10) / 10 : null,
        wind_gust: Math.max(...readings.map(r => r.wind_gust ?? 0)) || null,
        wind_direction: parseInt(mode(readings.map(r => r.wind_direction?.toString() ?? null)) || "0") || null,
        rain_rate: avg(readings.map(r => r.rain_rate)),
        cloud_condition: (cloud_condition || "Unknown") as CloudCondition,
        rain_condition: (mode(readings.map(r => r.rain_condition)) || "Unknown") as RainCondition,
        wind_condition: (mode(readings.map(r => r.wind_condition)) || "Unknown") as WindCondition,
        day_condition: (mode(readings.map(r => r.day_condition)) || "Unknown") as DayCondition,
        sky_temp: avg(readings.map(r => r.sky_temp)) !== null ? Math.round(avg(readings.map(r => r.sky_temp))! * 10) / 10 : null,
        ambient_temp: avg(readings.map(r => r.ambient_temp)) !== null ? Math.round(avg(readings.map(r => r.ambient_temp))! * 10) / 10 : null,
        sky_quality: sky_quality !== null ? Math.round(sky_quality * 100) / 100 : null,
        sqm_temperature: avg(readings.map(r => r.sqm_temperature)) !== null ? Math.round(avg(readings.map(r => r.sqm_temperature))! * 10) / 10 : null,
        updated_at: readings[0]?.created_at || new Date().toISOString(),
      };
    } else {
      // Fallback to legacy table
      const { data: legacyCurrent, error: legacyError } = await supabase
        .from("current_conditions")
        .select("*")
        .eq("id", 1)
        .single();

      if (legacyCurrent && !legacyError) {
        current = {
          temperature: legacyCurrent.temperature,
          humidity: legacyCurrent.humidity,
          pressure: legacyCurrent.pressure,
          dewpoint: legacyCurrent.dewpoint,
          wind_speed: legacyCurrent.wind_speed,
          wind_gust: legacyCurrent.wind_gust,
          wind_direction: legacyCurrent.wind_direction,
          rain_rate: legacyCurrent.rain_rate,
          cloud_condition: legacyCurrent.cloud_condition || "Unknown",
          rain_condition: legacyCurrent.rain_condition || "Unknown",
          wind_condition: legacyCurrent.wind_condition || "Unknown",
          day_condition: legacyCurrent.day_condition || "Unknown",
          sky_temp: legacyCurrent.sky_temp,
          ambient_temp: legacyCurrent.ambient_temp,
          sky_quality: legacyCurrent.sky_quality,
          sqm_temperature: legacyCurrent.sqm_temperature,
          updated_at: legacyCurrent.updated_at || new Date().toISOString(),
        };
      }
    }

    // Fetch SQM history from new instrument_readings table
    let sqmHistory: HistoricalReading[] = [];
    let sqmHistoryByInstrument: Record<string, HistoricalReading[]> = {};

    // Get instruments first to map IDs to codes
    const { data: instruments } = await supabase
      .from("instruments")
      .select("id, code, name");

    const instrumentMap = new Map(
      (instruments || []).map((i: { id: string; code: string }) => [i.id, i.code])
    );

    const { data: newSqmHistory, error: newHistoryError } = await supabase
      .from("instrument_readings")
      .select("created_at, sky_quality, instrument_id")
      .not("sky_quality", "is", null)
      .eq("is_outlier", false)
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      )
      .order("created_at", { ascending: true })
      .limit(1000); // Higher limit to accommodate multiple instruments

    if (newSqmHistory && !newHistoryError && newSqmHistory.length > 0) {
      // Group by instrument
      const byInstrument: Record<string, HistoricalReading[]> = {};

      for (const reading of newSqmHistory) {
        const instrumentCode = instrumentMap.get(reading.instrument_id) || "unknown";
        const histReading: HistoricalReading = {
          // Don't format time on server - let client format in local timezone
          time: "", // Will be formatted client-side
          timestamp: reading.created_at,
          sky_quality: reading.sky_quality,
          instrumentCode,
        };

        if (!byInstrument[instrumentCode]) {
          byInstrument[instrumentCode] = [];
        }
        byInstrument[instrumentCode].push(histReading);
      }

      sqmHistoryByInstrument = byInstrument;

      // Also create a merged site average history
      // Group readings by 5-minute windows and average them
      const windowMs = 5 * 60 * 1000;
      const windows: Map<number, { sum: number; count: number; timestamp: string }> = new Map();

      for (const reading of newSqmHistory) {
        const ts = new Date(reading.created_at).getTime();
        const windowStart = Math.floor(ts / windowMs) * windowMs;

        if (!windows.has(windowStart)) {
          windows.set(windowStart, { sum: 0, count: 0, timestamp: reading.created_at });
        }
        const w = windows.get(windowStart)!;
        w.sum += reading.sky_quality;
        w.count += 1;
      }

      sqmHistory = Array.from(windows.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, w]) => ({
          // Don't format time on server - let client format in local timezone
          time: "", // Will be formatted client-side
          timestamp: w.timestamp,
          sky_quality: w.sum / w.count,
        }));
    } else {
      // Fallback to legacy weather_readings
      const { data: legacyHistory } = await supabase
        .from("weather_readings")
        .select("created_at, sky_quality")
        .not("sky_quality", "is", null)
        .gte(
          "created_at",
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        )
        .order("created_at", { ascending: true })
        .limit(48);

      if (legacyHistory && legacyHistory.length > 0) {
        sqmHistory = legacyHistory.map(
          (reading: { created_at: string; sky_quality: number }) => ({
            // Don't format time on server - let client format in local timezone
            time: "", // Will be formatted client-side
            timestamp: reading.created_at,
            sky_quality: reading.sky_quality,
          })
        );
      }
    }

    // Fetch per-instrument readings for the detail modal
    let instrumentReadings;
    let failedInstruments;
    let telemetryHealth;
    let instrumentCount = 1;

    try {
      instrumentReadings = await fetchLatestInstrumentReadings(supabase);
      failedInstruments = await fetchFailedInstruments(supabase);
      telemetryHealth = await fetchTelemetryHealth(supabase);
      instrumentCount = Object.keys(instrumentReadings).length || 1;
    } catch (instError) {
      // Instrument tables might not exist yet - that's OK
      console.error("Error fetching instruments (may not exist yet):", instError);
      instrumentReadings = undefined;
      failedInstruments = undefined;
      telemetryHealth = undefined;
    }

    // Build response
    const response: ApiResponse = {
      current: current || getMockData(),
      sqmHistory: sqmHistory.length > 0 ? sqmHistory : getMockSQMHistory(),
      sqmHistoryByInstrument: Object.keys(sqmHistoryByInstrument).length > 0 ? sqmHistoryByInstrument : undefined,
      instrumentReadings,
      failedInstruments,
      telemetryHealth,
      instrumentCount,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("API error:", error);

    // Return mock data for development/demo
    return NextResponse.json({
      current: getMockData(),
      sqmHistory: getMockSQMHistory(),
    });
  }
}

// Mock data for development and demo purposes
function getMockData(): WeatherData {
  return {
    temperature: 18.5,
    humidity: 65,
    pressure: 1013.2,
    dewpoint: 12.1,
    wind_speed: 8.5,
    wind_gust: 15.2,
    wind_direction: 225,
    rain_rate: 0,
    cloud_condition: "Clear",
    rain_condition: "Dry",
    wind_condition: "Calm",
    day_condition: "Dark",
    sky_temp: -25.5,
    ambient_temp: 18.5,
    sky_quality: 21.35,
    sqm_temperature: 17.2,
    updated_at: new Date().toISOString(),
  };
}

function getMockSQMHistory(): HistoricalReading[] {
  const history: HistoricalReading[] = [];
  const now = Date.now();

  for (let i = 23; i >= 0; i--) {
    const time = new Date(now - i * 60 * 60 * 1000);
    const hour = time.getHours();

    // Simulate SQM values: darker at night, lighter during day
    let sqm = 21.5;
    if (hour >= 6 && hour < 8) sqm = 18 + Math.random();
    else if (hour >= 8 && hour < 18) sqm = 16 + Math.random();
    else if (hour >= 18 && hour < 20) sqm = 19 + Math.random();
    else sqm = 21 + Math.random() * 0.5;

    history.push({
      time: time.toLocaleTimeString("en-AU", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: time.toISOString(),
      sky_quality: sqm,
    });
  }

  return history;
}
