import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import {
  fetchFailedInstruments,
  fetchLatestInstrumentReadings,
} from "@/lib/instruments";
import { WeatherData, HistoricalReading, ApiResponse } from "@/types/weather";

export async function GET() {
  try {
    const supabase = createServerClient();

    // Fetch site conditions from the new aggregated view
    const { data: siteConditions, error: siteError } = await supabase
      .from("site_conditions")
      .select("*")
      .single();

    // Fallback to legacy current_conditions if site_conditions doesn't exist yet
    let current: WeatherData | null = null;

    if (siteConditions && !siteError) {
      current = {
        temperature: siteConditions.temperature,
        humidity: siteConditions.humidity,
        pressure: siteConditions.pressure,
        dewpoint: siteConditions.dewpoint,
        wind_speed: siteConditions.wind_speed,
        wind_gust: siteConditions.wind_gust,
        wind_direction: siteConditions.wind_direction,
        rain_rate: siteConditions.rain_rate,
        cloud_condition: siteConditions.cloud_condition || "Unknown",
        rain_condition: siteConditions.rain_condition || "Unknown",
        wind_condition: siteConditions.wind_condition || "Unknown",
        day_condition: siteConditions.day_condition || "Unknown",
        sky_temp: siteConditions.sky_temp,
        ambient_temp: siteConditions.ambient_temp,
        sky_quality: siteConditions.sky_quality,
        sqm_temperature: siteConditions.sqm_temperature,
        updated_at: siteConditions.updated_at || new Date().toISOString(),
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
          time: new Date(reading.created_at).toLocaleTimeString("en-AU", {
            hour: "2-digit",
            minute: "2-digit",
          }),
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
          time: new Date(w.timestamp).toLocaleTimeString("en-AU", {
            hour: "2-digit",
            minute: "2-digit",
          }),
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
            time: new Date(reading.created_at).toLocaleTimeString("en-AU", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            timestamp: reading.created_at,
            sky_quality: reading.sky_quality,
          })
        );
      }
    }

    // Fetch per-instrument readings for the detail modal
    let instrumentReadings;
    let failedInstruments;
    let instrumentCount = 1;

    try {
      instrumentReadings = await fetchLatestInstrumentReadings(supabase);
      failedInstruments = await fetchFailedInstruments(supabase);
      instrumentCount = Object.keys(instrumentReadings).length || 1;
    } catch (instError) {
      // Instrument tables might not exist yet - that's OK
      console.error("Error fetching instruments (may not exist yet):", instError);
      instrumentReadings = undefined;
      failedInstruments = undefined;
    }

    // Build response
    const response: ApiResponse = {
      current: current || getMockData(),
      sqmHistory: sqmHistory.length > 0 ? sqmHistory : getMockSQMHistory(),
      sqmHistoryByInstrument: Object.keys(sqmHistoryByInstrument).length > 0 ? sqmHistoryByInstrument : undefined,
      instrumentReadings,
      failedInstruments,
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
