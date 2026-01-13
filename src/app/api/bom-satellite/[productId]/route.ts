import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "child_process";

// Initialize Supabase client (may not be configured)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

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

// Find latest file matching product ID pattern
async function findLatestFile(productId: string): Promise<string | null> {
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
      return `${ftpDir}${simpleFile}`;
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
  const latestFile = matchingFiles[matchingFiles.length - 1];

  return `${ftpDir}${latestFile}`;
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
        const contentType = isRadar ? "image/gif" : "image/jpeg";
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
    const ftpUrl = await findLatestFile(productId);

    if (!ftpUrl) {
      return NextResponse.json(
        { error: "No files found for product", productId },
        { status: 404 }
      );
    }

    const imageData = await curlBinary(ftpUrl);

    if (imageData) {
      // Determine content type from URL
      const isGif = ftpUrl.endsWith(".gif");
      const contentType = isGif ? "image/gif" : "image/jpeg";

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
