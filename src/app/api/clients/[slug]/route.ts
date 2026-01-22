import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { Client, ClientDashboardState } from "@/types/client";

/**
 * GET /api/clients/:slug
 * Fetch a client and all their dashboard data
 * 
 * Public endpoint - returns all data for the client
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  if (!slug || typeof slug !== "string") {
    return NextResponse.json(
      { error: "Invalid client slug" },
      { status: 400 }
    );
  }

  try {
    const supabase = createServiceClient();

    // Fetch client
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (clientError || !client) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 }
      );
    }

    // Fetch current message of the day
    const { data: motdData } = await supabase
      .from("announcements")
      .select("*")
      .eq("client_id", client.id)
      .eq("is_motd", true)
      .eq("deleted_at", null)
      .lte("published_at", new Date().toISOString())
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .single();

    // Fetch active announcements
    const { data: announcements } = await supabase
      .from("announcements")
      .select("*")
      .eq("client_id", client.id)
      .eq("deleted_at", null)
      .lte("published_at", new Date().toISOString())
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("is_motd", { ascending: false })
      .order("priority", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(10);

    // Fetch cameras
    const { data: cameras } = await supabase
      .from("observatory_cameras")
      .select("*")
      .eq("client_id", client.id)
      .eq("is_active", true)
      .eq("is_public", true)
      .order("display_order", { ascending: true });

    // Fetch roof status
    const { data: roofStatus } = await supabase
      .from("roof_status")
      .select("*")
      .eq("client_id", client.id)
      .single();

    const dashboard: ClientDashboardState = {
      client: client as Client,
      motd: motdData || null,
      announcements: announcements || [],
      cameras: cameras || [],
      roofStatus: roofStatus || {
        id: "",
        client_id: client.id,
        state: "unknown",
        position: null,
        last_command: null,
        is_operational: true,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    };

    return NextResponse.json(
      { success: true, data: dashboard },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("Error fetching client dashboard:", error);
    return NextResponse.json(
      { error: "Failed to fetch client data" },
      { status: 500 }
    );
  }
}
