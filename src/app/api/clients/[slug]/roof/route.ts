import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { UpdateRoofStatusPayload, RoofCommand } from "@/types/client";

const INGEST_API_KEY = process.env.INGEST_API_KEY;

/**
 * GET /api/clients/:slug/roof
 * Fetch current roof status for a client
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const supabase = createServiceClient();

    // Find client
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("slug", slug)
      .single();

    if (clientError || !client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // Fetch roof status
    const { data: roofStatus, error: fetchError } = await supabase
      .from("roof_status")
      .select("*")
      .eq("client_id", client.id)
      .single();

    if (fetchError) {
      console.error("Error fetching roof status:", fetchError);
      return NextResponse.json(
        { error: "Roof status not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: roofStatus,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=10, s-maxage=20, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    console.error("Roof status fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/clients/:slug/roof
 * Update roof status (from Pi collector or control system)
 * 
 * Requires: Bearer token authentication
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Verify API key
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${INGEST_API_KEY}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = createServiceClient();
    const payload: UpdateRoofStatusPayload = await request.json();

    // Find client
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("slug", slug)
      .single();

    if (clientError || !client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // Update roof status
    const { data: updated, error: updateError } = await supabase
      .from("roof_status")
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", client.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating roof status:", updateError);
      return NextResponse.json(
        { error: "Failed to update roof status" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("Roof status update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/:slug/roof/command
 * Send a command to open/close/stop the roof
 * 
 * Requires: Bearer token authentication
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Verify API key
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${INGEST_API_KEY}`) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = createServiceClient();
    const { command, issued_by } = await request.json() as {
      command: RoofCommand;
      issued_by?: string;
    };

    if (!command || !["open", "close", "stop", "manual_override"].includes(command)) {
      return NextResponse.json(
        { error: "Invalid command" },
        { status: 400 }
      );
    }

    // Find client
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("slug", slug)
      .single();

    if (clientError || !client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // TODO: Actually send command to Pi controller (MQTT, HTTP, etc.)
    // For now, just log the command intent

    // Update roof status with command
    const { data: updated, error: updateError } = await supabase
      .from("roof_status")
      .update({
        last_command: command,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", client.id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating roof status:", updateError);
      return NextResponse.json(
        { error: "Failed to send command" },
        { status: 500 }
      );
    }

    // Log the command
    const { error: logError } = await supabase
      .from("roof_control_log")
      .insert({
        client_id: client.id,
        command,
        success: true,  // TODO: check if command was actually successful
        result_message: `Command ${command} sent to roof controller`,
        issued_by: issued_by || "api",
      });

    if (logError) {
      console.warn("Error logging roof command:", logError);
      // Don't fail the response if logging fails
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("Roof command error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
