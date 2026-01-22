import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { Redis } from "@upstash/redis";

const BUCKET_NAME = "allsky-images";
const ALLSKY_TIMESTAMP_KEY = "allsky:last_upload";

// Lazy-initialized Redis client
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      return null;
    }

    _redis = new Redis({ url, token });
  }
  return _redis;
}

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

    // Store upload timestamp in Redis for dashboard polling
    try {
      const redis = getRedis();
      if (redis) {
        await redis.set(ALLSKY_TIMESTAMP_KEY, timestamp, { ex: 3600 }); // 1 hour TTL
      }
    } catch (redisError) {
      // Non-fatal: log but don't fail the upload
      console.warn("Failed to update AllSky timestamp in Redis:", redisError);
    }

    return NextResponse.json({ success: true, timestamp });
  } catch (error) {
    console.error("Image upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
