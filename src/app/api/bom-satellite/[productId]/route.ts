import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";

// Initialize Supabase client (may not be configured)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

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

// Map product IDs to BOM FTP paths
function getBomFtpUrl(productId: string): string {
  if (isRadarProduct(productId)) {
    return `ftp://ftp.bom.gov.au/anon/gen/radar/${productId}.gif`;
  }
  // Satellite images
  return `ftp://ftp.bom.gov.au/anon/gen/gms/${productId}.jpg`;
}

// Fetch image via curl (supports FTP)
async function fetchViaCurl(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const curl = spawn("curl", ["-s", "-f", "--max-time", "15", url]);

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

  const isRadar = isRadarProduct(productId);
  const contentType = isRadar ? "image/gif" : "image/jpeg";

  // Try Supabase first if configured
  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const extension = isRadar ? "gif" : "jpg";
      const filename = `bom-satellite/${productId}.${extension}`;

      const { data, error } = await supabase.storage
        .from("allsky-images")
        .download(filename);

      if (!error && data) {
        const imageBuffer = await data.arrayBuffer();
        return new NextResponse(imageBuffer, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=300",
          },
        });
      }
    } catch (e) {
      console.log("Supabase fetch failed, falling back to FTP:", e);
    }
  }

  // Fallback: fetch directly from BOM FTP
  try {
    const ftpUrl = getBomFtpUrl(productId);
    const imageData = await fetchViaCurl(ftpUrl);

    if (imageData) {
      return new NextResponse(new Uint8Array(imageData), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    return NextResponse.json(
      { error: "Image not available", productId },
      { status: 404 }
    );
  } catch (error) {
    console.error("BOM satellite fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch satellite image" },
      { status: 500 }
    );
  }
}
