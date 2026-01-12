import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const BUCKET_NAME = "allsky-images";

export async function POST(request: NextRequest) {
  // Verify API key from Raspberry Pi
  const authHeader = request.headers.get("Authorization");
  const expectedKey = process.env.INGEST_API_KEY;

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Limit file size to 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString();
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload as 'latest.jpg' (overwrites previous)
    const { error: latestError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload("latest.jpg", buffer, {
        contentType: file.type,
        upsert: true,
        cacheControl: "60",
      });

    if (latestError) {
      console.error("Error uploading latest image:", latestError);
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    // Also save a timestamped archive copy (for timelapse)
    const archiveName = `archive/${timestamp.replace(/[:.]/g, "-")}.jpg`;
    await supabase.storage.from(BUCKET_NAME).upload(archiveName, buffer, {
      contentType: file.type,
      upsert: false,
    });

    return NextResponse.json({ success: true, timestamp });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
