import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  // Verify API key from Raspberry Pi
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const data = await request.json();
    const timestamp = new Date().toISOString();

    // Validate payload
    if (typeof data !== "object" || data === null) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Prepare the record
    const record = {
      temperature: data.temperature ?? null,
      humidity: data.humidity ?? null,
      pressure: data.pressure ?? null,
      dewpoint: data.dewpoint ?? null,
      wind_speed: data.wind_speed ?? null,
      wind_gust: data.wind_gust ?? null,
      wind_direction: data.wind_direction ?? null,
      rain_rate: data.rain_rate ?? null,
      cloud_condition: data.cloud_condition ?? "Unknown",
      rain_condition: data.rain_condition ?? "Unknown",
      wind_condition: data.wind_condition ?? "Unknown",
      day_condition: data.day_condition ?? "Unknown",
      sky_temp: data.sky_temp ?? null,
      ambient_temp: data.ambient_temp ?? null,
      sky_quality: data.sky_quality ?? null,
      sqm_temperature: data.sqm_temperature ?? null,
      lora_sensors: data.lora_sensors ?? null,
      updated_at: timestamp,
    };

    // Update current conditions (upsert)
    const { error: currentError } = await supabase
      .from("current_conditions")
      .upsert({ id: 1, ...record });

    if (currentError) {
      console.error("Error updating current conditions:", currentError);
      return NextResponse.json(
        { error: "Failed to update current conditions" },
        { status: 500 }
      );
    }

    // Also insert into historical readings
    const { error: historyError } = await supabase
      .from("weather_readings")
      .insert({ ...record, created_at: timestamp });

    if (historyError) {
      console.error("Error inserting historical reading:", historyError);
    }

    return NextResponse.json({ success: true, timestamp });
  } catch (error) {
    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
