/**
 * Weather data types used throughout the application
 */

export interface WeatherData {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  dewpoint: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_direction: number | null;
  rain_rate: number | null;
  cloud_condition: CloudCondition;
  rain_condition: RainCondition;
  wind_condition: WindCondition;
  day_condition: DayCondition;
  sky_temp: number | null;
  ambient_temp: number | null;
  sky_quality: number | null;
  sqm_temperature: number | null;
  updated_at: string;
}

export type CloudCondition = "Clear" | "Cloudy" | "VeryCloudy" | "Unknown";
export type RainCondition = "Dry" | "Wet" | "Rain" | "Unknown";
export type WindCondition = "Calm" | "Windy" | "VeryWindy" | "Unknown";
export type DayCondition = "Dark" | "Light" | "VeryLight" | "Unknown";
export type HumidityCondition = "Low" | "OK" | "High" | "VeryHigh" | "Unknown";
export type TempCondition = "Cold" | "OK" | "Warm" | "Hot" | "Unknown";

export interface HistoricalReading {
  time: string;
  timestamp: string;  // ISO timestamp for calculations
  sky_quality: number;
  moon_altitude?: number;  // Degrees above/below horizon
  instrumentCode?: string;  // Which instrument provided this reading
}

// ─────────────────────────────────────────────────────────────────────────────
// Instrument Types
// ─────────────────────────────────────────────────────────────────────────────

export type InstrumentType = "sqm" | "weather_station" | "cloudwatcher" | "allsky" | "unknown";
export type InstrumentStatus = "active" | "degraded" | "offline" | "maintenance";

export interface Instrument {
  id: string;
  code: string;
  name: string;
  instrument_type: InstrumentType;
  capabilities: string[];
  include_in_average: boolean;
  priority: number;
  status: InstrumentStatus;
  last_reading_at: string | null;
  consecutive_outliers: number;
  location_description?: string;
  calibration_offsets?: Record<string, number>;
  config?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Per-instrument current reading with metadata
 */
export interface InstrumentReading {
  instrumentId: string;
  instrumentCode: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  status: InstrumentStatus;
  isOutlier: boolean;
  outlierReason?: string;
  lastReadingAt: string;
  // Actual values (sparse - only what this instrument measures)
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
  cloud_condition?: CloudCondition;
  rain_condition?: RainCondition;
  wind_condition?: WindCondition;
  day_condition?: DayCondition;
}

/**
 * Failed instrument info for alert banner
 */
export interface FailedInstrument {
  code: string;
  name: string;
  status: "degraded" | "offline";
  lastReadingAt: string | null;
  consecutiveOutliers: number;
}

/**
 * API response with multi-instrument support
 */
export interface ApiResponse {
  // Site-averaged current conditions
  current: WeatherData;

  // SQM history (site average)
  sqmHistory: HistoricalReading[];

  // Per-instrument SQM history (for multi-SQM graph)
  sqmHistoryByInstrument?: Record<string, HistoricalReading[]>;

  // Per-instrument current values (for detail modal)
  instrumentReadings?: Record<string, InstrumentReading>;

  // Failed instruments (for alert banner)
  failedInstruments?: FailedInstrument[];

  // Metadata
  instrumentCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingest Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload received from collectors
 */
export interface IngestPayload {
  instrument_code?: string;  // Optional - uses 'default' if not provided
  temperature?: number;
  humidity?: number;
  pressure?: number;
  dewpoint?: number;
  wind_speed?: number;
  wind_gust?: number;
  wind_direction?: number;
  rain_rate?: number;
  cloud_condition?: string;
  rain_condition?: string;
  wind_condition?: string;
  day_condition?: string;
  sky_temp?: number;
  ambient_temp?: number;
  sky_quality?: number;
  sqm_temperature?: number;
  lora_sensors?: Record<string, unknown>;
}

/**
 * Metric names that can be measured
 */
export type MetricName =
  | "temperature"
  | "humidity"
  | "pressure"
  | "dewpoint"
  | "wind_speed"
  | "wind_gust"
  | "wind_direction"
  | "rain_rate"
  | "sky_temp"
  | "ambient_temp"
  | "sky_quality"
  | "sqm_temperature"
  | "cloud_condition"
  | "rain_condition"
  | "wind_condition"
  | "day_condition";

/**
 * Display metadata for metrics
 */
export const METRIC_DISPLAY: Record<MetricName, { label: string; unit: string; decimals: number }> = {
  temperature: { label: "Temperature", unit: "°C", decimals: 1 },
  humidity: { label: "Humidity", unit: "%", decimals: 0 },
  pressure: { label: "Pressure", unit: "hPa", decimals: 1 },
  dewpoint: { label: "Dew Point", unit: "°C", decimals: 1 },
  wind_speed: { label: "Wind Speed", unit: "km/h", decimals: 1 },
  wind_gust: { label: "Wind Gust", unit: "km/h", decimals: 1 },
  wind_direction: { label: "Wind Direction", unit: "°", decimals: 0 },
  rain_rate: { label: "Rain Rate", unit: "mm/hr", decimals: 2 },
  sky_temp: { label: "Sky Temp", unit: "°C", decimals: 1 },
  ambient_temp: { label: "Ambient Temp", unit: "°C", decimals: 1 },
  sky_quality: { label: "Sky Quality", unit: "mag/arcsec²", decimals: 2 },
  sqm_temperature: { label: "SQM Temp", unit: "°C", decimals: 1 },
  cloud_condition: { label: "Cloud", unit: "", decimals: 0 },
  rain_condition: { label: "Rain", unit: "", decimals: 0 },
  wind_condition: { label: "Wind", unit: "", decimals: 0 },
  day_condition: { label: "Daylight", unit: "", decimals: 0 },
};
