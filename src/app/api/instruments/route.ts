import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient } from "@/lib/supabase";
import { Instrument } from "@/types/weather";

/**
 * GET /api/instruments - List all instruments
 */
export async function GET() {
  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from("instruments")
      .select("*")
      .order("priority", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching instruments:", error);
      return NextResponse.json(
        { error: "Failed to fetch instruments" },
        { status: 500 }
      );
    }

    return NextResponse.json({ instruments: data || [] });
  } catch (error) {
    console.error("Instruments API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/instruments - Create a new instrument
 * Requires authentication
 */
export async function POST(request: NextRequest) {
  // Verify API key
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const body = await request.json();

    // Validate required fields
    if (!body.code || !body.name || !body.instrument_type) {
      return NextResponse.json(
        { error: "Missing required fields: code, name, instrument_type" },
        { status: 400 }
      );
    }

    // Validate code format (alphanumeric with dashes)
    if (!/^[a-z0-9-]+$/.test(body.code)) {
      return NextResponse.json(
        { error: "Code must be lowercase alphanumeric with dashes only" },
        { status: 400 }
      );
    }

    const instrument: Partial<Instrument> = {
      code: body.code,
      name: body.name,
      instrument_type: body.instrument_type,
      capabilities: body.capabilities || [],
      include_in_average: body.include_in_average ?? true,
      priority: body.priority ?? 0,
      status: body.status || "active",
      location_description: body.location_description,
      calibration_offsets: body.calibration_offsets || {},
      config: body.config || {},
    };

    const { data, error } = await supabase
      .from("instruments")
      .insert(instrument)
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Instrument with this code already exists" },
          { status: 409 }
        );
      }
      console.error("Error creating instrument:", error);
      return NextResponse.json(
        { error: "Failed to create instrument" },
        { status: 500 }
      );
    }

    return NextResponse.json({ instrument: data }, { status: 201 });
  } catch (error) {
    console.error("Create instrument error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
