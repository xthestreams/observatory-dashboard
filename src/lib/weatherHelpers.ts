/**
 * Helper functions for weather data display
 */

import {
  CloudCondition,
  WindCondition,
  RainCondition,
  DayCondition,
  HumidityCondition,
  TempCondition,
} from "@/types/weather";

// Icon mappings
export function getCloudIcon(condition: CloudCondition | undefined): string {
  switch (condition) {
    case "Clear":
      return "☀️";
    case "Cloudy":
      return "⛅";
    case "VeryCloudy":
      return "☁️";
    default:
      return "❓";
  }
}

export function getWindIcon(condition: WindCondition | undefined): string {
  switch (condition) {
    case "Calm":
      return "🍃";
    case "Windy":
      return "💨";
    case "VeryWindy":
      return "🌪️";
    default:
      return "❓";
  }
}

export function getRainIcon(condition: RainCondition | undefined): string {
  switch (condition) {
    case "Dry":
      return "☀️";
    case "Wet":
      return "💧";
    case "Rain":
      return "🌧️";
    default:
      return "❓";
  }
}

export function getDayIcon(condition: DayCondition | undefined): string {
  switch (condition) {
    case "Dark":
      return "🌙";
    case "Light":
      return "🌅";
    case "VeryLight":
      return "☀️";
    default:
      return "❓";
  }
}

// Condition color mappings
type ConditionType = "cloud" | "wind" | "rain" | "humidity" | "day" | "temp";

const colorMappings: Record<ConditionType, Record<string, string>> = {
  cloud: {
    Clear: "#22c55e",
    Cloudy: "#f59e0b",
    VeryCloudy: "#ef4444",
    Unknown: "#666",
  },
  wind: {
    Calm: "#22c55e",
    Windy: "#f59e0b",
    VeryWindy: "#ef4444",
    Unknown: "#666",
  },
  rain: {
    Dry: "#22c55e",
    Wet: "#f59e0b",
    Rain: "#ef4444",
    Unknown: "#666",
  },
  humidity: {
    Low: "#22c55e",
    OK: "#22c55e",
    High: "#f59e0b",
    VeryHigh: "#ef4444",
    Unknown: "#666",
  },
  day: {
    Dark: "#22c55e",
    Light: "#f59e0b",
    VeryLight: "#ef4444",
    Unknown: "#666",
  },
  temp: {
    Cold: "#3b82f6",
    OK: "#22c55e",
    Warm: "#f59e0b",
    Hot: "#ef4444",
    Unknown: "#666",
  },
};

export function getConditionColor(
  condition: string | undefined,
  type: ConditionType
): string {
  return colorMappings[type]?.[condition || "Unknown"] || "#666";
}

// Derived condition calculations
export function getHumidityCondition(
  humidity: number | null | undefined
): HumidityCondition {
  if (humidity === null || humidity === undefined) return "Unknown";
  if (humidity < 40) return "Low";
  if (humidity < 70) return "OK";
  if (humidity < 85) return "High";
  return "VeryHigh";
}

export function getTempCondition(
  temp: number | null | undefined
): TempCondition {
  if (temp === null || temp === undefined) return "Unknown";
  if (temp < 5) return "Cold";
  if (temp < 25) return "OK";
  if (temp < 35) return "Warm";
  return "Hot";
}

// Wind direction to compass
export function getWindDirection(degrees: number): string {
  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}
