import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

const BUCKET_NAME = "allsky-images";

// Valid product IDs for BOM satellite images
const SATELLITE_PRODUCTS = [
  "IDE00135",        // Australia True Color
  "IDE00135-RADAR",  // Australia Radar Composite
  "IDE00005",        // Australia Visible (B&W)
  "IDE00006",        // Australia Infrared (B&W)
  "IDE00153",        // Hemisphere Full Disk
];

// Radar products follow pattern IDRxx[1-4] where xx is station code
// 1=512km, 2=256km, 3=128km, 4=64km
const RADAR_PATTERN = /^IDR\d{2}[1-4]$/;

function isValidProductId(productId: string): boolean {
  return SATELLITE_PRODUCTS.includes(productId) || RADAR_PATTERN.test(productId);
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
    const productId = formData.get("product_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    if (!productId || !isValidProductId(productId)) {
      return NextResponse.json(
        { error: `Invalid product_id: ${productId}` },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    // Limit file size to 5MB for satellite images
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large (max 5MB)" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Determine file extension based on content type
    const isGif = file.type === "image/gif";
    const extension = isGif ? "gif" : "jpg";

    // Upload to bom-satellite/{productId}.{ext}
    const filename = `bom-satellite/${productId}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: true,
        cacheControl: "300", // 5 minute cache
      });

    if (uploadError) {
      console.error(`Error uploading satellite image ${productId}:`, uploadError);
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      product_id: productId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Satellite image upload error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
