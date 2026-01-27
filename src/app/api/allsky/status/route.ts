import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const ALLSKY_TIMESTAMP_KEY = "allsky:last_upload";

// Short edge cache - 15 seconds is enough for responsive polling
// while reducing origin transfers (polling is now 30s)
export const revalidate = 15;

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

export async function GET() {
  try {
    const redis = getRedis();

    if (!redis) {
      return NextResponse.json(
        { lastUpload: null, error: "Redis not configured" },
        { status: 200 }
      );
    }

    const lastUpload = await redis.get<string>(ALLSKY_TIMESTAMP_KEY);

    return NextResponse.json({
      lastUpload,
      serverTime: new Date().toISOString(),
    }, {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    console.error("Error fetching AllSky status:", error);
    return NextResponse.json(
      { lastUpload: null, error: "Failed to fetch status" },
      { status: 200 }
    );
  }
}
