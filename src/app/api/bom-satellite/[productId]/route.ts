import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { spawn } from "child_process";
import { Redis } from "@upstash/redis";

// Cache for 5 minutes at edge - BOM images update every 10-30 minutes
// This enables ISR caching and reduces origin transfers significantly
export const revalidate = 300;

// Initialize Supabase client (may not be configured)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

// Lazy-initialized Redis client for metadata tracking
let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  _redis = new Redis({ url, token });
  return _redis;
}

// Redis key prefix for BOM metadata
const BOM_METADATA_PREFIX = "bom:metadata:";
// TTL for metadata entries (1 hour)
const METADATA_TTL_SECONDS = 60 * 60;

interface BomMetadata {
  filename: string;
  fetchedAt: string;
  size: number;
}

// Valid satellite product IDs
const SATELLITE_PRODUCTS = [
  "IDE00135",        // Australia True Color (with radar overlay)
  "IDE00005",        // Australia Visible (B&W)
  "IDE00006",        // Australia Infrared (B&W)
  "IDE00153",        // Hemisphere Full Disk
];

// Radar products follow pattern IDRxx[1-4] where xx is station code
const RADAR_PATTERN = /^IDR\d{2}[1-4]$/;

function isValidProductId(productId: string): boolean {
  return SATELLITE_PRODUCTS.includes(productId) || RADAR_PATTERN.test(productId);
}

function isRadarProduct(productId: string): boolean {
  return RADAR_PATTERN.test(productId);
}

// Get the FTP directory for a product
function getFtpDir(productId: string): string {
  if (isRadarProduct(productId)) {
    return "ftp://ftp.bom.gov.au/anon/gen/radar/";
  }
  return "ftp://ftp.bom.gov.au/anon/gen/gms/";
}

// Execute curl and return output as string
async function curlText(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const curl = spawn("curl", ["-s", "--max-time", "10", url]);

    curl.stdout.on("data", (data) => {
      chunks.push(Buffer.from(data));
    });

    curl.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks).toString("utf-8"));
      } else {
        resolve(null);
      }
    });

    curl.on("error", () => {
      resolve(null);
    });
  });
}

// Fetch binary data via curl
async function curlBinary(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const curl = spawn("curl", ["-s", "-f", "--max-time", "30", url]);

    curl.stdout.on("data", (data) => {
      chunks.push(Buffer.from(data));
    });

    curl.on("close", (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        resolve(null);
      }
    });

    curl.on("error", () => {
      resolve(null);
    });
  });
}

// Extract filename from FTP ls -l format line
function extractFilename(line: string): string | null {
  // Format: -rw-rw-r--    1 1050     1502       212587 Dec 22 23:51 IDE00005.202512222330.gif
  // The filename is the last field after the date/time
  const parts = line.trim().split(/\s+/);
  if (parts.length >= 9) {
    // Filename is everything after the 8th field (index 8+)
    return parts.slice(8).join(" ");
  }
  return null;
}

// Find latest filename (just the filename, not full URL)
async function findLatestFilename(productId: string): Promise<string | null> {
  const ftpDir = getFtpDir(productId);
  const listing = await curlText(ftpDir);

  if (!listing) {
    return null;
  }

  // Parse listing and extract filenames
  const lines = listing.split("\n").filter(Boolean);
  const filenames = lines
    .map(extractFilename)
    .filter((f): f is string => f !== null);

  const isRadar = isRadarProduct(productId);

  // For radar: IDR661.gif (simple name)
  // For satellite: IDE00135.radar.202601122230.jpg (timestamped)

  let matchingFiles: string[] = [];

  if (isRadar) {
    // Radar files are simple: IDRxxx.gif
    const simpleFile = `${productId}.gif`;
    if (filenames.includes(simpleFile)) {
      return simpleFile;
    }
    // Also check for timestamped radar files
    matchingFiles = filenames.filter(f => f.startsWith(productId + "."));
  } else {
    // Satellite files are timestamped: IDE00135.radar.202601122230.jpg
    // or IDE00005.202512231830.gif
    matchingFiles = filenames.filter(f => f.startsWith(productId + "."));
  }

  if (matchingFiles.length === 0) {
    return null;
  }

  // Sort to get the latest (timestamps are in YYYYMMDDHHMM format)
  matchingFiles.sort();
  return matchingFiles[matchingFiles.length - 1];
}

// Get cached metadata from Redis
async function getCachedMetadata(productId: string): Promise<BomMetadata | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const data = await redis.get<BomMetadata>(`${BOM_METADATA_PREFIX}${productId}`);
    return data;
  } catch (e) {
    console.log("Redis get metadata failed:", e);
    return null;
  }
}

// Save metadata to Redis
async function saveCachedMetadata(productId: string, metadata: BomMetadata): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.set(`${BOM_METADATA_PREFIX}${productId}`, metadata, {
      ex: METADATA_TTL_SECONDS,
    });
  } catch (e) {
    console.log("Redis set metadata failed:", e);
  }
}

// Upload image to Supabase Storage
async function uploadToSupabase(
  supabase: SupabaseClient,
  productId: string,
  imageData: Buffer,
  isGif: boolean
): Promise<boolean> {
  try {
    const extension = isGif ? "gif" : "jpg";
    const contentType = isGif ? "image/gif" : "image/jpeg";
    const filename = `bom-satellite/${productId}.${extension}`;

    const { error } = await supabase.storage
      .from("allsky-images")
      .upload(filename, imageData, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.log("Supabase upload failed:", error);
      return false;
    }

    return true;
  } catch (e) {
    console.log("Supabase upload error:", e);
    return false;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;

  if (!isValidProductId(productId)) {
    return NextResponse.json(
      { error: `Unknown product ID: ${productId}` },
      { status: 400 }
    );
  }

  const isRadar = isRadarProduct(productId);
  const ftpDir = getFtpDir(productId);

  // Check if we have cached metadata and Supabase is configured
  const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

  // Step 1: Check what's the latest file on BOM FTP (lightweight directory listing)
  const latestFilename = await findLatestFilename(productId);

  if (!latestFilename) {
    return NextResponse.json(
      { error: "No files found for product", productId },
      { status: 404 }
    );
  }

  // Step 2: Check if we already have this file cached
  const cachedMetadata = await getCachedMetadata(productId);
  const isNewFile = !cachedMetadata || cachedMetadata.filename !== latestFilename;

  // Step 3: If file hasn't changed and we have Supabase, try to serve from cache
  if (!isNewFile && supabase) {
    try {
      const extension = isRadar ? "gif" : "jpg";
      const storagePath = `bom-satellite/${productId}.${extension}`;

      const { data, error } = await supabase.storage
        .from("allsky-images")
        .download(storagePath);

      if (!error && data) {
        const imageBuffer = await data.arrayBuffer();
        const contentType = isRadar ? "image/gif" : "image/jpeg";
        return new NextResponse(imageBuffer, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=300",
            "X-BOM-Source": "supabase-cache",
            "X-BOM-Filename": latestFilename,
          },
        });
      }
    } catch (e) {
      console.log("Supabase cache fetch failed, will re-download:", e);
    }
  }

  // Step 4: Download fresh image from BOM FTP
  const ftpUrl = `${ftpDir}${latestFilename}`;
  const imageData = await curlBinary(ftpUrl);

  if (!imageData) {
    return NextResponse.json(
      { error: "Image not available", productId },
      { status: 404 }
    );
  }

  // Step 5: Upload to Supabase for future requests (if configured)
  const isGif = latestFilename.endsWith(".gif");
  if (supabase) {
    await uploadToSupabase(supabase, productId, imageData, isGif);
  }

  // Step 6: Update metadata in Redis
  await saveCachedMetadata(productId, {
    filename: latestFilename,
    fetchedAt: new Date().toISOString(),
    size: imageData.length,
  });

  // Step 7: Return the image
  const contentType = isGif ? "image/gif" : "image/jpeg";

  return new NextResponse(new Uint8Array(imageData), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=300",
      "X-BOM-Source": "ftp-fresh",
      "X-BOM-Filename": latestFilename,
    },
  });
}
