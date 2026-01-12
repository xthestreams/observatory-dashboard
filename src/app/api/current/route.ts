import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = createServerClient();

    // Fetch current conditions
    const { data: current, error: currentError } = await supabase
      .from("current_conditions")
      .select("*")
      .eq("id", 1)
      .single();

    if (currentError) {
      console.error("Error fetching current conditions:", currentError);
    }

    // Fetch last 24 hours of SQM readings for the graph
    const { data: sqmHistory, error: historyError } = await supabase
      .from("weather_readings")
      .select("created_at, sky_quality")
      .not("sky_quality", "is", null)
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      )
      .order("created_at", { ascending: true })
      .limit(48);

    if (historyError) {
      console.error("Error fetching SQM history:", historyError);
    }

    // Format SQM history for the graph
    const formattedHistory = (sqmHistory || []).map(
      (reading: { created_at: string; sky_quality: number }) => ({
        time: new Date(reading.created_at).toLocaleTimeString("en-AU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        sky_quality: reading.sky_quality,
      })
    );

    return NextResponse.json({
      current: current || getMockData(),
      sqmHistory: formattedHistory.length > 0 ? formattedHistory : getMockSQMHistory(),
    });
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
function getMockData() {
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

function getMockSQMHistory() {
  const history = [];
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
      sky_quality: sqm,
    });
  }

  return history;
}
