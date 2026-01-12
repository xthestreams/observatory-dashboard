import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

// Valid satellite product IDs
const SATELLITE_PRODUCTS = [
  "IDE00135",        // Australia True Color
  "IDE00135-RADAR",  // Australia Radar Composite
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;

  if (!isValidProductId(productId)) {
    return NextResponse.json(
      { error: `Unknown product ID: ${productId}` },
      { status: 400 }
    );
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Radar images are GIFs, satellite images are JPGs (except some are GIFs)
    const isRadar = isRadarProduct(productId);
    const extension = isRadar ? "gif" : "jpg";
    const filename = `bom-satellite/${productId}.${extension}`;

    const { data, error } = await supabase.storage
      .from("allsky-images")
      .download(filename);

    if (error || !data) {
      // Return a placeholder or error
      return NextResponse.json(
        { error: "Image not available", productId },
        { status: 404 }
      );
    }

    const imageBuffer = await data.arrayBuffer();
    const contentType = isRadar ? "image/gif" : "image/jpeg";

    return new NextResponse(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300", // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error("BOM satellite fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch satellite image" },
      { status: 500 }
    );
  }
}
