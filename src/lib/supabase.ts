import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Browser client (for React components)
export function createBrowserClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Server client for read operations (API routes)
export function createServerClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  );
}

// Server client for write operations (API routes with elevated permissions)
export function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

// TypeScript types for our data
export interface WeatherReading {
  id?: number;
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  dewpoint: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_direction: number | null;
  rain_rate: number | null;
  cloud_condition: "Clear" | "Cloudy" | "VeryCloudy" | "Unknown";
  rain_condition: "Dry" | "Wet" | "Rain" | "Unknown";
  wind_condition: "Calm" | "Windy" | "VeryWindy" | "Unknown";
  day_condition: "Dark" | "Light" | "VeryLight" | "Unknown";
  sky_temp: number | null;
  ambient_temp: number | null;
  sky_quality: number | null;
  sqm_temperature: number | null;
  lora_sensors: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}
