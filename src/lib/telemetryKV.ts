/**
 * Upstash Redis-based telemetry state for persistent health tracking.
 *
 * This module uses Upstash Redis to store collector heartbeats with
 * instrument health statuses. The collector is the source of truth
 * for instrument health - the server simply stores and retrieves it.
 *
 * Rate limiting: All reads and writes are rate-limited to 120-second intervals
 * to stay under Upstash's free tier limit of 10,000 requests/day.
 *
 * Keys used:
 * - telemetry:heartbeat - Collector heartbeat state with instrument health
 */

import { Redis } from "@upstash/redis";
import { TelemetryHealth, CollectorHeartbeat, FailedInstrument, PowerStatus } from "@/types/weather";

// Lazy-initialized Upstash Redis client
let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error("Redis credentials not found. Set KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN");
    }

    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Stale threshold for heartbeat (5 minutes)
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

// Rate limiting: 120 seconds between KV operations
const RATE_LIMIT_MS = 120 * 1000;

// KV key for heartbeat
const KEY_HEARTBEAT = "telemetry:heartbeat";

// TTL for KV entries (30 minutes)
const KV_TTL_SECONDS = 30 * 60;

/**
 * Instrument health status from collector
 */
interface InstrumentHealthStatus {
  status: "HEALTHY" | "DEGRADED" | "OFFLINE";
  failure_rate: number;
}

/**
 * Power status from UPS
 */
interface PowerStatusState {
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

/**
 * Heartbeat state stored in KV
 */
interface HeartbeatState {
  timestamp: number;
  instruments: string[];
  instrument_health: Record<string, InstrumentHealthStatus>;
  collectorVersion: string | null;
  uptimeSeconds: number | null;
  powerStatus: PowerStatusState | null;
}

/**
 * Reading values for conditions aggregation
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
 * In-memory cache for rate limiting
 */
let localCache: {
  lastWriteTime: number;
  lastReadTime: number;
  cachedHealth: TelemetryHealth | null;
  pendingHeartbeat: HeartbeatState | null;
} = {
  lastWriteTime: 0,
  lastReadTime: 0,
  cachedHealth: null,
  pendingHeartbeat: null,
};

function canWriteToKV(): boolean {
  return Date.now() - localCache.lastWriteTime >= RATE_LIMIT_MS;
}

function canReadFromKV(): boolean {
  return Date.now() - localCache.lastReadTime >= RATE_LIMIT_MS;
}

/**
 * Update heartbeat state from collector
 */
export async function updateHeartbeat(data: {
  instruments: string[];
  instrument_health?: Record<string, InstrumentHealthStatus>;
  collector_version?: string;
  uptime_seconds?: number;
  power_status?: PowerStatusState | null;
}): Promise<void> {
  const heartbeat: HeartbeatState = {
    timestamp: Date.now(),
    instruments: data.instruments,
    instrument_health: data.instrument_health || {},
    collectorVersion: data.collector_version || null,
    uptimeSeconds: data.uptime_seconds || null,
    powerStatus: data.power_status || null,
  };

  // Always update local pending state
  localCache.pendingHeartbeat = heartbeat;

  // Invalidate cached health since we have new data
  localCache.cachedHealth = null;

  // Try to flush to KV if rate limit allows
  if (canWriteToKV()) {
    await flushToKV();
  }
}

/**
 * Flush pending state to Redis
 */
async function flushToKV(): Promise<void> {
  try {
    if (localCache.pendingHeartbeat) {
      await getRedis().set(
        KEY_HEARTBEAT,
        JSON.stringify(localCache.pendingHeartbeat),
        { ex: KV_TTL_SECONDS }
      );

      localCache.lastWriteTime = Date.now();
      // Don't clear pendingHeartbeat - keep it for local reads
    }
  } catch (error) {
    console.error("Error flushing to Redis:", error);
  }
}

/**
 * Get telemetry health - uses collector-reported health statuses
 */
export async function getTelemetryHealth(): Promise<TelemetryHealth> {
  // Use local pending state if we have it and can't read from KV
  if (!canReadFromKV() && localCache.pendingHeartbeat) {
    return buildHealthFromHeartbeat(localCache.pendingHeartbeat);
  }

  // Also return cached health if available and within rate limit
  if (!canReadFromKV() && localCache.cachedHealth) {
    return localCache.cachedHealth;
  }

  try {
    // Fetch from Redis
    const heartbeatStr = await getRedis().get<string>(KEY_HEARTBEAT);
    localCache.lastReadTime = Date.now();

    // Parse heartbeat
    const heartbeat = heartbeatStr
      ? (typeof heartbeatStr === 'string' ? JSON.parse(heartbeatStr) : heartbeatStr) as HeartbeatState
      : null;

    // Use most recent: Redis or local pending
    const effectiveHeartbeat = getMoreRecentHeartbeat(heartbeat, localCache.pendingHeartbeat);

    if (!effectiveHeartbeat) {
      return getUnknownHealth();
    }

    const health = buildHealthFromHeartbeat(effectiveHeartbeat);
    localCache.cachedHealth = health;
    return health;
  } catch (error) {
    console.error("Error reading from Redis:", error);

    // Fall back to local state
    if (localCache.pendingHeartbeat) {
      return buildHealthFromHeartbeat(localCache.pendingHeartbeat);
    }

    return getUnknownHealth();
  }
}

/**
 * Get the more recent heartbeat between Redis and local
 */
function getMoreRecentHeartbeat(
  redis: HeartbeatState | null,
  local: HeartbeatState | null
): HeartbeatState | null {
  if (!redis && !local) return null;
  if (!redis) return local;
  if (!local) return redis;
  return local.timestamp > redis.timestamp ? local : redis;
}

/**
 * Build TelemetryHealth from collector-reported heartbeat
 */
function buildHealthFromHeartbeat(heartbeat: HeartbeatState): TelemetryHealth {
  const now = Date.now();
  const ageMs = now - heartbeat.timestamp;
  const heartbeatIsStale = ageMs > HEARTBEAT_STALE_MS;

  // Build power status - if heartbeat is stale, mark power as "down"
  let powerStatus: PowerStatus | null = null;
  if (heartbeat.powerStatus) {
    powerStatus = {
      ...heartbeat.powerStatus,
      // Override status to "down" if heartbeat is stale (no recent communication)
      status: heartbeatIsStale ? "down" : heartbeat.powerStatus.status,
    };
  }

  // Build collector heartbeat status
  const collectorHeartbeat: CollectorHeartbeat = {
    status: heartbeatIsStale ? "stale" : "ok",
    lastHeartbeat: new Date(heartbeat.timestamp).toISOString(),
    instruments: heartbeat.instruments,
    collectorVersion: heartbeat.collectorVersion,
    uptimeSeconds: heartbeat.uptimeSeconds,
    ageMs,
    powerStatus,
  };

  // Count instruments by health status (from collector-reported data)
  const degradedInstruments: FailedInstrument[] = [];
  const offlineInstruments: FailedInstrument[] = [];
  let activeCount = 0;

  for (const code of heartbeat.instruments) {
    const health = heartbeat.instrument_health[code];

    if (!health || health.status === "HEALTHY") {
      activeCount++;
    } else if (health.status === "DEGRADED") {
      degradedInstruments.push({
        code,
        name: code,
        status: "degraded",
        lastReadingAt: new Date(heartbeat.timestamp).toISOString(),
        consecutiveOutliers: Math.round(health.failure_rate * 10),
      });
    } else if (health.status === "OFFLINE") {
      offlineInstruments.push({
        code,
        name: code,
        status: "offline",
        lastReadingAt: new Date(heartbeat.timestamp).toISOString(),
        consecutiveOutliers: Math.round(health.failure_rate * 10),
      });
    }
  }

  // Determine overall status
  let status: TelemetryHealth["status"] = "operational";

  if (heartbeatIsStale) {
    status = "offline";
  } else if (offlineInstruments.length > 0) {
    // If all instruments are offline, system is offline; otherwise degraded
    status = activeCount === 0 ? "offline" : "degraded";
  } else if (degradedInstruments.length > 0) {
    status = "degraded";
  }

  return {
    status,
    expectedCount: heartbeat.instruments.length,
    activeCount,
    degradedInstruments,
    offlineInstruments,
    lastConfigUpdate: new Date(heartbeat.timestamp).toISOString(),
    collectorHeartbeat,
  };
}

/**
 * Get unknown/offline health status
 */
function getUnknownHealth(): TelemetryHealth {
  return {
    status: "offline",
    expectedCount: 0,
    activeCount: 0,
    degradedInstruments: [],
    offlineInstruments: [],
    lastConfigUpdate: null,
    collectorHeartbeat: {
      status: "unknown",
      lastHeartbeat: null,
      instruments: [],
      collectorVersion: null,
      uptimeSeconds: null,
      ageMs: Infinity,
    },
  };
}

/**
 * Get aggregated conditions - placeholder for KV-based conditions
 * Returns empty conditions since we now rely on Supabase for actual readings
 */
export async function getAggregatedConditions(): Promise<ReadingValues & { updated_at: string | null }> {
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
  localPendingHeartbeat: HeartbeatState | null;
  lastWriteTime: string | null;
  lastReadTime: string | null;
  canWrite: boolean;
  canRead: boolean;
}> {
  let redisHeartbeat: HeartbeatState | null = null;

  try {
    const heartbeatStr = await getRedis().get<string>(KEY_HEARTBEAT);
    redisHeartbeat = heartbeatStr
      ? (typeof heartbeatStr === 'string' ? JSON.parse(heartbeatStr) : heartbeatStr) as HeartbeatState
      : null;
  } catch (error) {
    console.error("Error fetching debug state from Redis:", error);
  }

  return {
    redisHeartbeat,
    localPendingHeartbeat: localCache.pendingHeartbeat,
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
