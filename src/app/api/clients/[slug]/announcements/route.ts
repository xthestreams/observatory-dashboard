import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { CreateAnnouncementPayload } from "@/types/client";

const INGEST_API_KEY = process.env.INGEST_API_KEY;

/**
 * POST /api/clients/:slug/announcements
 * Create or update an announcement for a client
 * 
 * Requires: Bearer token authentication
 * Used by: Raspberry Pi collector or admin API
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
    const payload: CreateAnnouncementPayload = await request.json();

    // Validate payload
    if (!payload.title || !payload.content) {
      return NextResponse.json(
        { error: "title and content are required" },
        { status: 400 }
      );
    }

    // Find client by slug
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

    // Insert announcement
    const { data: announcement, error: insertError } = await supabase
      .from("announcements")
      .insert({
        client_id: client.id,
        title: payload.title,
        content: payload.content,
        type: payload.type || "info",
        priority: payload.priority || 0,
        is_motd: payload.is_motd || false,
        published_at: payload.published_at || new Date().toISOString(),
        expires_at: payload.expires_at || null,
        created_by: payload.created_by || "api",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting announcement:", insertError);
      return NextResponse.json(
        { error: "Failed to create announcement" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: announcement,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Announcement creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clients/:slug/announcements
 * Fetch announcements for a client
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

    // Fetch announcements
    const { data: announcements, error: fetchError } = await supabase
      .from("announcements")
      .select("*")
      .eq("client_id", client.id)
      .eq("deleted_at", null)
      .lte("published_at", new Date().toISOString())
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("is_motd", { ascending: false })
      .order("priority", { ascending: false })
      .order("published_at", { ascending: false });

    if (fetchError) {
      console.error("Error fetching announcements:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch announcements" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: announcements || [],
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("Announcements fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
