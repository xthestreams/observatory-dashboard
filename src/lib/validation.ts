/**
 * Zod validation schemas for API endpoints.
 *
 * Runtime validation for incoming data to ensure type safety
 * and provide clear error messages for invalid requests.
 */

import { z } from "zod";

// Condition enums matching the database
export const CloudConditionSchema = z.enum([
  "Unknown",
  "Clear",
  "Cloudy",
  "VeryCloudy",
  "Overcast",
]);

export const RainConditionSchema = z.enum([
  "Unknown",
  "Dry",
  "Damp",
  "Wet",
  "Rain",
]);

export const WindConditionSchema = z.enum([
  "Unknown",
  "Calm",
  "Windy",
  "VeryWindy",
  "Gusty",
]);

export const DayConditionSchema = z.enum([
  "Unknown",
  "Dark",
  "Light",
  "VeryLight",
]);

// LoRa sensor data schema
export const LoRaSensorSchema = z.record(
  z.string(),
  z.object({
    value: z.number(),
    unit: z.string().optional(),
    timestamp: z.string().datetime().optional(),
  }).passthrough()
).nullable().optional();

// Main ingest payload schema
// Using transform to convert null to undefined to match IngestPayload type
const nullToUndefined = <T>(val: T | null | undefined): T | undefined =>
  val === null ? undefined : val;

export const IngestPayloadSchema = z.object({
  instrument_code: z.string().min(1).max(50).optional(),

  // Weather measurements - accept null but transform to undefined
  temperature: z.number().min(-50).max(60).nullish().transform(nullToUndefined),
  humidity: z.number().min(0).max(100).nullish().transform(nullToUndefined),
  pressure: z.number().min(800).max(1100).nullish().transform(nullToUndefined),
  dewpoint: z.number().min(-50).max(60).nullish().transform(nullToUndefined),

  // Wind
  wind_speed: z.number().min(0).max(200).nullish().transform(nullToUndefined),
  wind_gust: z.number().min(0).max(300).nullish().transform(nullToUndefined),
  wind_direction: z.number().min(0).max(360).nullish().transform(nullToUndefined),

  // Rain
  rain_rate: z.number().min(0).nullish().transform(nullToUndefined),

  // Sky conditions
  sky_temp: z.number().min(-100).max(50).nullish().transform(nullToUndefined),
  ambient_temp: z.number().min(-50).max(60).nullish().transform(nullToUndefined),

  // SQM - min 0 to allow daytime readings when sensor is saturated
  sky_quality: z.number().min(0).max(25).nullish().transform(nullToUndefined),
  sqm_temperature: z.number().min(-50).max(60).nullish().transform(nullToUndefined),

  // Condition classifications - accept string for flexibility
  cloud_condition: z.string().nullish().transform(nullToUndefined),
  rain_condition: z.string().nullish().transform(nullToUndefined),
  wind_condition: z.string().nullish().transform(nullToUndefined),
  day_condition: z.string().nullish().transform(nullToUndefined),

  // LoRa sensors (flexible structure)
  lora_sensors: z.record(z.string(), z.unknown()).nullish().transform(nullToUndefined),
}).passthrough(); // Allow additional fields for forward compatibility

export type ValidatedIngestPayload = z.infer<typeof IngestPayloadSchema>;

// Heartbeat payload schema
export const HeartbeatPayloadSchema = z.object({
  status: z.enum(["healthy", "degraded", "offline"]).optional(),
  uptime: z.number().min(0).optional(),
  activeInstruments: z.number().min(0).optional(),
  failedInstruments: z.array(z.object({
    code: z.string(),
    name: z.string().optional(),
    status: z.enum(["degraded", "offline"]),
  })).optional(),
  instrumentHealth: z.record(
    z.string(),
    z.object({
      status: z.enum(["healthy", "degraded", "offline"]),
      failureRate: z.number().min(0).max(1).optional(),
      readingCount: z.number().min(0).optional(),
    })
  ).optional(),
  powerStatus: z.object({
    status: z.enum(["good", "degraded", "down", "unknown"]),
    upsStatus: z.string().optional(),
    batteryCharge: z.number().min(0).max(100).optional(),
    inputVoltage: z.number().optional(),
  }).optional(),
}).passthrough();

export type ValidatedHeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

// Image upload validation
export const ImageUploadSchema = z.object({
  product_id: z.string().min(1).max(20).optional(),
});

// Format Zod errors for API responses
export function formatZodError(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((e) => ({
      path: e.path.join("."),
      message: e.message,
      code: e.code,
    })),
  };
}
