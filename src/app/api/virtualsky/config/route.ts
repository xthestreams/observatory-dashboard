import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Default VirtualSky configuration
const DEFAULT_CONFIG = {
  enabled: true,
  azOffset: 0,
  projection: "polar",
  showConstellations: true,
  showConstellationLabels: true,
  showPlanets: true,
  showPlanetLabels: true,
  showStarLabels: false,
  showCardinalPoints: true,
  showMeridian: false,
  magnitude: 5,
  opacity: 0.7,
};

// GET - Retrieve VirtualSky configuration
export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("site_config")
      .select("value")
      .eq("key", "virtualsky_config")
      .single();

    if (error || !data) {
      // Return defaults if not configured
      return NextResponse.json(DEFAULT_CONFIG);
    }

    return NextResponse.json({ ...DEFAULT_CONFIG, ...data.value });
  } catch (error) {
    console.error("Error fetching VirtualSky config:", error);
    return NextResponse.json(DEFAULT_CONFIG);
  }
}

// POST - Update VirtualSky configuration (requires password)
export async function POST(request: NextRequest) {
  try {
    // Check password
    const setupPassword = process.env.SETUP_PASSWORD;
    if (!setupPassword) {
      return NextResponse.json(
        { error: "Setup password not configured" },
        { status: 500 }
      );
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || authHeader !== `Bearer ${setupPassword}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const config = await request.json();

    // Validate config
    if (typeof config !== "object") {
      return NextResponse.json({ error: "Invalid config" }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Upsert the configuration
    const { error } = await supabase.from("site_config").upsert(
      {
        key: "virtualsky_config",
        value: config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );

    if (error) {
      console.error("Error saving VirtualSky config:", error);
      return NextResponse.json(
        { error: "Failed to save config" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating VirtualSky config:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
