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
  sky_quality: number;
}

export interface ApiResponse {
  current: WeatherData;
  sqmHistory: HistoricalReading[];
}
