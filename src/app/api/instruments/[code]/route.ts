import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient } from "@/lib/supabase";

interface RouteParams {
  params: Promise<{ code: string }>;
}

/**
 * GET /api/instruments/:code - Get a specific instrument
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { code } = await params;
    const supabase = createServerClient();

    const { data: instrument, error } = await supabase
      .from("instruments")
      .select("*")
      .eq("code", code)
      .single();

    if (error || !instrument) {
      return NextResponse.json(
        { error: "Instrument not found" },
        { status: 404 }
      );
    }

    // Also fetch recent readings for this instrument
    const { data: readings } = await supabase
      .from("instrument_readings")
      .select("*")
      .eq("instrument_id", instrument.id)
      .order("created_at", { ascending: false })
      .limit(10);

    return NextResponse.json({
      instrument,
      recentReadings: readings || [],
    });
  } catch (error) {
    console.error("Get instrument error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/instruments/:code - Update an instrument
 * Requires authentication
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  // Verify API key
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code } = await params;
    const supabase = createServiceClient();
    const body = await request.json();

    // Build update object with only allowed fields
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.instrument_type !== undefined)
      updates.instrument_type = body.instrument_type;
    if (body.capabilities !== undefined) updates.capabilities = body.capabilities;
    if (body.include_in_average !== undefined)
      updates.include_in_average = body.include_in_average;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.status !== undefined) updates.status = body.status;
    if (body.location_description !== undefined)
      updates.location_description = body.location_description;
    if (body.calibration_offsets !== undefined)
      updates.calibration_offsets = body.calibration_offsets;
    if (body.config !== undefined) updates.config = body.config;

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("instruments")
      .update(updates)
      .eq("code", code)
      .select()
      .single();

    if (error) {
      console.error("Error updating instrument:", error);
      return NextResponse.json(
        { error: "Failed to update instrument" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Instrument not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ instrument: data });
  } catch (error) {
    console.error("Update instrument error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/instruments/:code - Delete an instrument
 * Requires authentication
 * Note: This will fail if there are readings referencing this instrument
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  // Verify API key
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code } = await params;
    const supabase = createServiceClient();

    // Prevent deletion of the default instrument
    if (code === "default") {
      return NextResponse.json(
        { error: "Cannot delete the default instrument" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("instruments")
      .delete()
      .eq("code", code);

    if (error) {
      if (error.code === "23503") {
        return NextResponse.json(
          {
            error:
              "Cannot delete instrument with existing readings. Set status to 'offline' instead.",
          },
          { status: 400 }
        );
      }
      console.error("Error deleting instrument:", error);
      return NextResponse.json(
        { error: "Failed to delete instrument" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete instrument error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
