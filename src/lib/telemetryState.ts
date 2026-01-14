/**
 * In-memory telemetry state for Vercel serverless functions.
 *
 * This module maintains state about collector heartbeats and instrument readings
 * WITHOUT relying on Supabase queries. State is updated when:
 * - Heartbeat is received from collector (POST /api/heartbeat)
 * - Data is ingested from collector (POST /api/ingest/data)
 *
 * Note: Vercel serverless functions can be scaled across multiple instances,
 * so this state is per-instance. However, since we're using it for health
 * detection based on recency (not historical accuracy), this is acceptable.
 * Each instance will have up-to-date state as long as it receives requests.
 *
 * The state automatically expires - if no updates are received within the
 * stale threshold, the health check will report degraded/offline status.
 */

import { TelemetryHealth, CollectorHeartbeat, FailedInstrument } from "@/types/weather";

// Stale thresholds
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;  // 5 minutes - collector should heartbeat every 60s
const READING_STALE_MS = 15 * 60 * 1000;   // 15 minutes - readings should come every 60s

/**
 * Reading values that can be stored in memory
 */
export interface ReadingValues {
  temperature?: number | null;
  humidity?: number | null;
  pressure?: number | null;
  dewpoint?: number | null;
  wind_speed?: number | null;
  wind_gust?: number | null;
  wind_direction?: number | null;
  rain_rate?: number | null;
  sky_temp?: number | null;
  ambient_temp?: number | null;
  sky_quality?: number | null;
  sqm_temperature?: number | null;
  cloud_condition?: string | null;
  rain_condition?: string | null;
  wind_condition?: string | null;
  day_condition?: string | null;
}

/**
 * In-memory state for a single instrument's last reading
 */
interface InstrumentState {
  code: string;
  name: string;
  instrumentType: string;
  lastReadingAt: number;  // Unix timestamp ms
  consecutiveOutliers: number;
  values: ReadingValues;  // Actual measurement values
}

/**
 * In-memory state for collector heartbeat
 */
interface HeartbeatState {
  timestamp: number;  // Unix timestamp ms
  instruments: string[];
  collectorVersion: string | null;
  uptimeSeconds: number | null;
}

/**
 * Global state - persists across requests within the same Vercel instance
 */
let heartbeatState: HeartbeatState | null = null;
let instrumentStates: Map<string, InstrumentState> = new Map();
let expectedInstruments: Set<string> = new Set();

/**
 * Update heartbeat state when collector sends a heartbeat
 */
export function updateHeartbeat(data: {
  instruments: string[];
  collector_version?: string;
  uptime_seconds?: number;
}): void {
  heartbeatState = {
    timestamp: Date.now(),
    instruments: data.instruments,
    collectorVersion: data.collector_version || null,
    uptimeSeconds: data.uptime_seconds || null,
  };

  // Update expected instruments from heartbeat
  expectedInstruments = new Set(data.instruments);
}

/**
 * Update instrument state when data is ingested
 */
export function updateInstrumentReading(
  code: string,
  name: string,
  instrumentType: string,
  values: ReadingValues,
  isOutlier: boolean = false
): void {
  const existing = instrumentStates.get(code);

  instrumentStates.set(code, {
    code,
    name,
    instrumentType,
    lastReadingAt: Date.now(),
    consecutiveOutliers: isOutlier
      ? (existing?.consecutiveOutliers || 0) + 1
      : 0,
    values,
  });
}

/**
 * Get current readings from in-memory state
 * Returns readings for all instruments that have reported data
 */
export function getCurrentReadings(): Record<string, {
  code: string;
  name: string;
  instrumentType: string;
  lastReadingAt: string;
  isStale: boolean;
  values: ReadingValues;
}> {
  const now = Date.now();
  const result: Record<string, {
    code: string;
    name: string;
    instrumentType: string;
    lastReadingAt: string;
    isStale: boolean;
    values: ReadingValues;
  }> = {};

  instrumentStates.forEach((state, code) => {
    result[code] = {
      code: state.code,
      name: state.name,
      instrumentType: state.instrumentType,
      lastReadingAt: new Date(state.lastReadingAt).toISOString(),
      isStale: (now - state.lastReadingAt) > READING_STALE_MS,
      values: state.values,
    };
  });

  return result;
}

/**
 * Get aggregated current conditions from in-memory readings
 * Averages numeric values and takes mode for categorical values
 */
export function getAggregatedConditions(): ReadingValues & { updated_at: string | null } {
  const now = Date.now();
  const freshReadings: ReadingValues[] = [];

  instrumentStates.forEach((state) => {
    // Only include fresh readings (not stale)
    if ((now - state.lastReadingAt) <= READING_STALE_MS) {
      freshReadings.push(state.values);
    }
  });

  if (freshReadings.length === 0) {
    return {
      temperature: null,
      humidity: null,
      pressure: null,
      dewpoint: null,
      wind_speed: null,
      wind_gust: null,
      wind_direction: null,
      rain_rate: null,
      sky_temp: null,
      ambient_temp: null,
      sky_quality: null,
      sqm_temperature: null,
      cloud_condition: null,
      rain_condition: null,
      wind_condition: null,
      day_condition: null,
      updated_at: null,
    };
  }

  // Helper to average numeric values
  const avg = (arr: (number | null | undefined)[]): number | null => {
    const valid = arr.filter((x): x is number => x !== null && x !== undefined);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  };

  // Helper to get mode of string values
  const mode = (arr: (string | null | undefined)[]): string | null => {
    const valid = arr.filter((x): x is string => x !== null && x !== undefined);
    if (valid.length === 0) return null;
    const counts = valid.reduce((acc, v) => {
      acc[v] = (acc[v] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  };

  // Find the most recent timestamp
  let latestTimestamp = 0;
  instrumentStates.forEach((state) => {
    if (state.lastReadingAt > latestTimestamp) {
      latestTimestamp = state.lastReadingAt;
    }
  });

  return {
    temperature: avg(freshReadings.map(r => r.temperature)),
    humidity: avg(freshReadings.map(r => r.humidity)),
    pressure: avg(freshReadings.map(r => r.pressure)),
    dewpoint: avg(freshReadings.map(r => r.dewpoint)),
    wind_speed: avg(freshReadings.map(r => r.wind_speed)),
    wind_gust: Math.max(...freshReadings.map(r => r.wind_gust ?? 0)) || null,
    wind_direction: avg(freshReadings.map(r => r.wind_direction)),
    rain_rate: avg(freshReadings.map(r => r.rain_rate)),
    sky_temp: avg(freshReadings.map(r => r.sky_temp)),
    ambient_temp: avg(freshReadings.map(r => r.ambient_temp)),
    sky_quality: avg(freshReadings.map(r => r.sky_quality)),
    sqm_temperature: avg(freshReadings.map(r => r.sqm_temperature)),
    cloud_condition: mode(freshReadings.map(r => r.cloud_condition)),
    rain_condition: mode(freshReadings.map(r => r.rain_condition)),
    wind_condition: mode(freshReadings.map(r => r.wind_condition)),
    day_condition: mode(freshReadings.map(r => r.day_condition)),
    updated_at: latestTimestamp > 0 ? new Date(latestTimestamp).toISOString() : null,
  };
}

/**
 * Get current telemetry health based on in-memory state
 * This is the primary function for determining health - no Supabase needed
 */
export function getTelemetryHealth(): TelemetryHealth {
  const now = Date.now();

  // Build collector heartbeat status
  let collectorHeartbeat: CollectorHeartbeat;

  if (!heartbeatState) {
    collectorHeartbeat = {
      status: "unknown",
      lastHeartbeat: null,
      instruments: [],
      collectorVersion: null,
      uptimeSeconds: null,
      ageMs: Infinity,
    };
  } else {
    const ageMs = now - heartbeatState.timestamp;
    collectorHeartbeat = {
      status: ageMs > HEARTBEAT_STALE_MS ? "stale" : "ok",
      lastHeartbeat: new Date(heartbeatState.timestamp).toISOString(),
      instruments: heartbeatState.instruments,
      collectorVersion: heartbeatState.collectorVersion,
      uptimeSeconds: heartbeatState.uptimeSeconds,
      ageMs,
    };
  }

  // Determine instrument health
  const degradedInstruments: FailedInstrument[] = [];
  const offlineInstruments: FailedInstrument[] = [];
  let activeCount = 0;

  // Use expected instruments from heartbeat, or fall back to known instruments
  const expectedArray = Array.from(expectedInstruments);
  const instrumentsToCheck = expectedArray.length > 0
    ? expectedArray
    : Array.from(instrumentStates.keys());

  for (const code of instrumentsToCheck) {
    const state = instrumentStates.get(code);

    if (!state) {
      // Instrument is expected but has never reported
      offlineInstruments.push({
        code,
        name: code,
        status: "offline",
        lastReadingAt: null,
        consecutiveOutliers: 0,
      });
      continue;
    }

    const readingAgeMs = now - state.lastReadingAt;

    if (readingAgeMs > READING_STALE_MS) {
      // Stale reading - offline
      offlineInstruments.push({
        code: state.code,
        name: state.name,
        status: "offline",
        lastReadingAt: new Date(state.lastReadingAt).toISOString(),
        consecutiveOutliers: state.consecutiveOutliers,
      });
    } else if (state.consecutiveOutliers >= 3) {
      // Too many outliers - degraded
      degradedInstruments.push({
        code: state.code,
        name: state.name,
        status: "degraded",
        lastReadingAt: new Date(state.lastReadingAt).toISOString(),
        consecutiveOutliers: state.consecutiveOutliers,
      });
    } else {
      // Healthy
      activeCount++;
    }
  }

  const expectedCount = instrumentsToCheck.length;

  // Determine overall status
  let status: TelemetryHealth["status"] = "operational";

  // If heartbeat is stale, we can't trust the data
  if (collectorHeartbeat.status === "stale" || collectorHeartbeat.status === "unknown") {
    status = "offline";
  } else if (offlineInstruments.length > 0) {
    status = expectedCount > 0 && activeCount === 0 ? "offline" : "degraded";
  } else if (degradedInstruments.length > 0) {
    status = "degraded";
  }

  return {
    status,
    expectedCount,
    activeCount,
    degradedInstruments,
    offlineInstruments,
    lastConfigUpdate: heartbeatState
      ? new Date(heartbeatState.timestamp).toISOString()
      : null,
    collectorHeartbeat,
  };
}

/**
 * Get raw state for debugging
 */
export function getDebugState(): {
  heartbeat: HeartbeatState | null;
  instruments: Record<string, InstrumentState>;
  expected: string[];
} {
  return {
    heartbeat: heartbeatState,
    instruments: Object.fromEntries(instrumentStates),
    expected: Array.from(expectedInstruments),
  };
}
