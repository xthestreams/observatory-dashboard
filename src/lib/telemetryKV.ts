/**
 * Upstash Redis-based telemetry state for persistent health tracking.
 *
 * This module uses Upstash Redis to store collector heartbeats and instrument
 * readings persistently across Vercel instances and restarts.
 *
 * Rate limiting: All reads and writes are rate-limited to 120-second intervals
 * to stay under Upstash's free tier limit of 10,000 requests/day.
 * (24 hours * 60 minutes / 2 minutes = 720 requests/day per operation type)
 *
 * Keys used:
 * - telemetry:heartbeat - Collector heartbeat state
 * - telemetry:instrument:{code} - Per-instrument reading state
 * - telemetry:expected - Set of expected instrument codes
 */

import { Redis } from "@upstash/redis";
import { TelemetryHealth, CollectorHeartbeat, FailedInstrument } from "@/types/weather";

// Lazy-initialized Upstash Redis client
// Avoids errors during build when env vars aren't available
// Supports both Vercel KV naming (KV_REST_API_*) and Upstash naming (UPSTASH_REDIS_REST_*)
let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    // Try Vercel KV naming first, then Upstash naming
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error("Redis credentials not found. Set KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN");
    }

    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Stale thresholds
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;  // 5 minutes
const READING_STALE_MS = 15 * 60 * 1000;   // 15 minutes

// Rate limiting: 120 seconds between KV operations
const RATE_LIMIT_MS = 120 * 1000;

// KV key prefixes
const KEYS = {
  heartbeat: "telemetry:heartbeat",
  instrument: (code: string) => `telemetry:instrument:${code}`,
  expected: "telemetry:expected",
  cacheHealth: "telemetry:cache:health",
  cacheConditions: "telemetry:cache:conditions",
  lastWrite: "telemetry:last_write",
  lastRead: "telemetry:last_read",
};

// TTL for KV entries (30 minutes - longer than stale threshold)
const KV_TTL_SECONDS = 30 * 60;

/**
 * Reading values stored in KV
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
 * Heartbeat state stored in KV
 */
interface HeartbeatState {
  timestamp: number;
  instruments: string[];
  collectorVersion: string | null;
  uptimeSeconds: number | null;
}

/**
 * Instrument state stored in KV
 */
interface InstrumentState {
  code: string;
  name: string;
  instrumentType: string;
  lastReadingAt: number;
  consecutiveOutliers: number;
  values: ReadingValues;
}

/**
 * In-memory cache for rate limiting
 * Stores last operation timestamps and cached results
 */
let localCache: {
  lastWriteTime: number;
  lastReadTime: number;
  cachedHealth: TelemetryHealth | null;
  cachedConditions: (ReadingValues & { updated_at: string | null }) | null;
  pendingHeartbeat: HeartbeatState | null;
  pendingInstruments: Map<string, InstrumentState>;
} = {
  lastWriteTime: 0,
  lastReadTime: 0,
  cachedHealth: null,
  cachedConditions: null,
  pendingHeartbeat: null,
  pendingInstruments: new Map(),
};

/**
 * Check if enough time has passed since last KV write
 */
function canWriteToKV(): boolean {
  return Date.now() - localCache.lastWriteTime >= RATE_LIMIT_MS;
}

/**
 * Check if enough time has passed since last KV read
 */
function canReadFromKV(): boolean {
  return Date.now() - localCache.lastReadTime >= RATE_LIMIT_MS;
}

/**
 * Update heartbeat state - buffers locally and flushes to KV when rate limit allows
 */
export async function updateHeartbeat(data: {
  instruments: string[];
  collector_version?: string;
  uptime_seconds?: number;
}): Promise<void> {
  const heartbeat: HeartbeatState = {
    timestamp: Date.now(),
    instruments: data.instruments,
    collectorVersion: data.collector_version || null,
    uptimeSeconds: data.uptime_seconds || null,
  };

  // Always update local pending state
  localCache.pendingHeartbeat = heartbeat;

  // Try to flush to KV if rate limit allows
  if (canWriteToKV()) {
    await flushToKV();
  }
}

/**
 * Update instrument reading - buffers locally and flushes to KV when rate limit allows
 */
export async function updateInstrumentReading(
  code: string,
  name: string,
  instrumentType: string,
  values: ReadingValues,
  isOutlier: boolean = false
): Promise<void> {
  const existing = localCache.pendingInstruments.get(code);

  const instrumentState: InstrumentState = {
    code,
    name,
    instrumentType,
    lastReadingAt: Date.now(),
    consecutiveOutliers: isOutlier
      ? (existing?.consecutiveOutliers || 0) + 1
      : 0,
    values,
  };

  // Always update local pending state
  localCache.pendingInstruments.set(code, instrumentState);

  // Try to flush to KV if rate limit allows
  if (canWriteToKV()) {
    await flushToKV();
  }
}

/**
 * Flush pending state to Redis
 * Called when rate limit window has passed
 */
async function flushToKV(): Promise<void> {
  try {
    const pipeline = getRedis().pipeline();

    // Write heartbeat if pending
    if (localCache.pendingHeartbeat) {
      pipeline.set(KEYS.heartbeat, JSON.stringify(localCache.pendingHeartbeat), { ex: KV_TTL_SECONDS });

      // Update expected instruments set
      if (localCache.pendingHeartbeat.instruments.length > 0) {
        pipeline.del(KEYS.expected);
        for (const inst of localCache.pendingHeartbeat.instruments) {
          pipeline.sadd(KEYS.expected, inst);
        }
        pipeline.expire(KEYS.expected, KV_TTL_SECONDS);
      }
    }

    // Write instrument states
    const pendingEntries = Array.from(localCache.pendingInstruments.entries());
    for (const [code, state] of pendingEntries) {
      pipeline.set(KEYS.instrument(code), JSON.stringify(state), { ex: KV_TTL_SECONDS });
    }

    // Execute pipeline
    await pipeline.exec();

    // Update last write time
    localCache.lastWriteTime = Date.now();

    // Clear pending state after successful write
    localCache.pendingHeartbeat = null;
    localCache.pendingInstruments.clear();

    // Invalidate cached results
    localCache.cachedHealth = null;
    localCache.cachedConditions = null;
  } catch (error) {
    console.error("Error flushing to Redis:", error);
    // Keep pending state for next attempt
  }
}

/**
 * Get telemetry health from Redis with rate-limited reads
 */
export async function getTelemetryHealth(): Promise<TelemetryHealth> {
  // Return cached result if within rate limit window
  // But still merge with any pending local state (which may be more recent)
  if (!canReadFromKV() && localCache.cachedHealth) {
    // Use empty map for redis states since we're using cached health
    // The merge function will rebuild with local pending data if available
    return mergeLocalStateIntoHealth(
      localCache.cachedHealth,
      new Map(),  // No fresh Redis data
      localCache.cachedHealth.collectorHeartbeat?.instruments || []
    );
  }

  try {
    // Fetch from Redis
    const [heartbeatStr, expectedSet] = await Promise.all([
      getRedis().get<string>(KEYS.heartbeat),
      getRedis().smembers<string[]>(KEYS.expected),
    ]);

    const heartbeat = heartbeatStr ? (typeof heartbeatStr === 'string' ? JSON.parse(heartbeatStr) : heartbeatStr) as HeartbeatState : null;

    // Get all instrument states
    const instrumentCodes = expectedSet.length > 0
      ? expectedSet
      : Array.from(localCache.pendingInstruments.keys());

    const instrumentStates: Map<string, InstrumentState> = new Map();

    if (instrumentCodes.length > 0) {
      const keys = instrumentCodes.map(code => KEYS.instrument(code as string));
      const values = await getRedis().mget<string[]>(...keys);

      for (let i = 0; i < instrumentCodes.length; i++) {
        if (values[i]) {
          const parsed = typeof values[i] === 'string' ? JSON.parse(values[i] as string) : values[i];
          instrumentStates.set(instrumentCodes[i] as string, parsed as InstrumentState);
        }
      }
    }

    // Update last read time
    localCache.lastReadTime = Date.now();

    // Build health status from Redis data
    const health = buildHealthStatus(
      heartbeat || localCache.pendingHeartbeat,
      instrumentStates,
      instrumentCodes as string[]
    );

    // Cache the result (before merging local state)
    localCache.cachedHealth = health;

    // Merge any pending local state (may have more recent data)
    return mergeLocalStateIntoHealth(health, instrumentStates, instrumentCodes as string[]);
  } catch (error) {
    console.error("Error reading from Redis:", error);

    // Fall back to local state only
    return buildHealthStatus(
      localCache.pendingHeartbeat,
      localCache.pendingInstruments,
      Array.from(localCache.pendingInstruments.keys())
    );
  }
}

/**
 * Get aggregated conditions from Redis with rate-limited reads
 */
export async function getAggregatedConditions(): Promise<ReadingValues & { updated_at: string | null }> {
  // Return cached result if within rate limit window
  if (!canReadFromKV() && localCache.cachedConditions) {
    // Update with any pending local state
    return mergeLocalConditions(localCache.cachedConditions);
  }

  try {
    // Get expected instruments
    const expectedSet = await getRedis().smembers<string[]>(KEYS.expected);
    const instrumentCodes = expectedSet.length > 0
      ? expectedSet
      : Array.from(localCache.pendingInstruments.keys());

    if (instrumentCodes.length === 0) {
      return getEmptyConditions();
    }

    // Fetch instrument states
    const keys = instrumentCodes.map(code => KEYS.instrument(code as string));
    const values = await getRedis().mget<string[]>(...keys);

    // Update last read time
    localCache.lastReadTime = Date.now();

    // Parse and aggregate readings
    const parsedStates: InstrumentState[] = [];
    for (const v of values) {
      if (v) {
        const parsed = typeof v === 'string' ? JSON.parse(v) : v;
        parsedStates.push(parsed as InstrumentState);
      }
    }

    // Aggregate readings
    const conditions = aggregateReadings(parsedStates);

    // Cache the result
    localCache.cachedConditions = conditions;

    // Merge any pending local state
    return mergeLocalConditions(conditions);
  } catch (error) {
    console.error("Error reading conditions from Redis:", error);

    // Fall back to local state only
    return aggregateReadings(Array.from(localCache.pendingInstruments.values()));
  }
}

/**
 * Build health status from state data
 */
function buildHealthStatus(
  heartbeat: HeartbeatState | null,
  instrumentStates: Map<string, InstrumentState>,
  expectedInstruments: string[]
): TelemetryHealth {
  const now = Date.now();

  // Build collector heartbeat status
  let collectorHeartbeat: CollectorHeartbeat;

  if (!heartbeat) {
    collectorHeartbeat = {
      status: "unknown",
      lastHeartbeat: null,
      instruments: [],
      collectorVersion: null,
      uptimeSeconds: null,
      ageMs: Infinity,
    };
  } else {
    const ageMs = now - heartbeat.timestamp;
    collectorHeartbeat = {
      status: ageMs > HEARTBEAT_STALE_MS ? "stale" : "ok",
      lastHeartbeat: new Date(heartbeat.timestamp).toISOString(),
      instruments: heartbeat.instruments,
      collectorVersion: heartbeat.collectorVersion,
      uptimeSeconds: heartbeat.uptimeSeconds,
      ageMs,
    };
  }

  // Determine instrument health
  const degradedInstruments: FailedInstrument[] = [];
  const offlineInstruments: FailedInstrument[] = [];
  let activeCount = 0;

  const instrumentsToCheck = expectedInstruments.length > 0
    ? expectedInstruments
    : Array.from(instrumentStates.keys());

  for (const code of instrumentsToCheck) {
    const state = instrumentStates.get(code);

    if (!state) {
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
      offlineInstruments.push({
        code: state.code,
        name: state.name,
        status: "offline",
        lastReadingAt: new Date(state.lastReadingAt).toISOString(),
        consecutiveOutliers: state.consecutiveOutliers,
      });
    } else if (state.consecutiveOutliers >= 3) {
      degradedInstruments.push({
        code: state.code,
        name: state.name,
        status: "degraded",
        lastReadingAt: new Date(state.lastReadingAt).toISOString(),
        consecutiveOutliers: state.consecutiveOutliers,
      });
    } else {
      activeCount++;
    }
  }

  const expectedCount = instrumentsToCheck.length;

  // Determine overall status
  let status: TelemetryHealth["status"] = "operational";

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
    lastConfigUpdate: heartbeat
      ? new Date(heartbeat.timestamp).toISOString()
      : null,
    collectorHeartbeat,
  };
}

/**
 * Merge pending local state into health result
 * This is critical for when we have fresh local data but rate-limited Redis reads
 */
function mergeLocalStateIntoHealth(
  health: TelemetryHealth,
  redisInstrumentStates: Map<string, InstrumentState>,
  expectedInstruments: string[]
): TelemetryHealth {
  const now = Date.now();

  // If we have a more recent pending heartbeat, use it
  if (localCache.pendingHeartbeat) {
    const pendingAge = now - localCache.pendingHeartbeat.timestamp;
    const currentAge = health.collectorHeartbeat?.ageMs ?? Infinity;

    if (pendingAge < currentAge) {
      health.collectorHeartbeat = {
        status: pendingAge > HEARTBEAT_STALE_MS ? "stale" : "ok",
        lastHeartbeat: new Date(localCache.pendingHeartbeat.timestamp).toISOString(),
        instruments: localCache.pendingHeartbeat.instruments,
        collectorVersion: localCache.pendingHeartbeat.collectorVersion,
        uptimeSeconds: localCache.pendingHeartbeat.uptimeSeconds,
        ageMs: pendingAge,
      };
    }
  }

  // Merge pending instrument states with Redis states
  // Local pending data is more recent and should take precedence
  if (localCache.pendingInstruments.size > 0) {
    // Create merged map: start with Redis data, overlay local pending data
    const mergedStates = new Map(redisInstrumentStates);
    const pendingEntries = Array.from(localCache.pendingInstruments.entries());
    for (const [code, state] of pendingEntries) {
      const existingState = mergedStates.get(code);
      // Use local state if it's more recent
      if (!existingState || state.lastReadingAt > existingState.lastReadingAt) {
        mergedStates.set(code, state);
      }
    }

    // Rebuild health status with merged data
    const pendingKeys = Array.from(localCache.pendingInstruments.keys());
    const mergedExpected = Array.from(new Set([...expectedInstruments, ...pendingKeys]));
    return buildHealthStatus(
      localCache.pendingHeartbeat || (health.collectorHeartbeat ? {
        timestamp: health.collectorHeartbeat.lastHeartbeat ? new Date(health.collectorHeartbeat.lastHeartbeat).getTime() : 0,
        instruments: health.collectorHeartbeat.instruments,
        collectorVersion: health.collectorHeartbeat.collectorVersion,
        uptimeSeconds: health.collectorHeartbeat.uptimeSeconds,
      } : null),
      mergedStates,
      mergedExpected
    );
  }

  return health;
}

/**
 * Merge pending local conditions into result
 */
function mergeLocalConditions(
  conditions: ReadingValues & { updated_at: string | null }
): ReadingValues & { updated_at: string | null } {
  if (localCache.pendingInstruments.size === 0) {
    return conditions;
  }

  // Re-aggregate including pending instruments
  const allStates = Array.from(localCache.pendingInstruments.values());
  const pendingConditions = aggregateReadings(allStates);

  // Use pending if more recent
  if (pendingConditions.updated_at && (!conditions.updated_at ||
      new Date(pendingConditions.updated_at) > new Date(conditions.updated_at))) {
    return pendingConditions;
  }

  return conditions;
}

/**
 * Aggregate readings from multiple instruments
 */
function aggregateReadings(states: InstrumentState[]): ReadingValues & { updated_at: string | null } {
  const now = Date.now();
  const freshReadings: ReadingValues[] = [];

  for (const state of states) {
    if ((now - state.lastReadingAt) <= READING_STALE_MS) {
      freshReadings.push(state.values);
    }
  }

  if (freshReadings.length === 0) {
    return getEmptyConditions();
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
  for (const state of states) {
    if (state.lastReadingAt > latestTimestamp) {
      latestTimestamp = state.lastReadingAt;
    }
  }

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
 * Get empty conditions object
 */
function getEmptyConditions(): ReadingValues & { updated_at: string | null } {
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

/**
 * Get debug state (for troubleshooting)
 */
export async function getDebugState(): Promise<{
  redisHeartbeat: HeartbeatState | null;
  redisExpected: string[];
  localPendingHeartbeat: HeartbeatState | null;
  localPendingInstruments: Record<string, InstrumentState>;
  lastWriteTime: string | null;
  lastReadTime: string | null;
  canWrite: boolean;
  canRead: boolean;
}> {
  let redisHeartbeat: HeartbeatState | null = null;
  let redisExpected: string[] = [];

  try {
    const [heartbeatStr, expectedSet] = await Promise.all([
      getRedis().get<string>(KEYS.heartbeat),
      getRedis().smembers<string[]>(KEYS.expected),
    ]);
    redisHeartbeat = heartbeatStr ? (typeof heartbeatStr === 'string' ? JSON.parse(heartbeatStr) : heartbeatStr) as HeartbeatState : null;
    redisExpected = expectedSet as string[];
  } catch (error) {
    console.error("Error fetching debug state from Redis:", error);
  }

  return {
    redisHeartbeat,
    redisExpected,
    localPendingHeartbeat: localCache.pendingHeartbeat,
    localPendingInstruments: Object.fromEntries(localCache.pendingInstruments),
    lastWriteTime: localCache.lastWriteTime > 0
      ? new Date(localCache.lastWriteTime).toISOString()
      : null,
    lastReadTime: localCache.lastReadTime > 0
      ? new Date(localCache.lastReadTime).toISOString()
      : null,
    canWrite: canWriteToKV(),
    canRead: canReadFromKV(),
  };
}
