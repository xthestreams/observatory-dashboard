import { NextResponse } from "next/server";

const BUCKET_NAME = "allsky-images";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

// Cache for 5 minutes at edge - AllSky images update every few minutes
// Removed cache-busting timestamp to allow proper edge caching
export const revalidate = 300;

export async function GET() {
  if (!SUPABASE_URL) {
    return new NextResponse(null, { status: 500 });
  }

  // Use public URL directly (bucket is public)
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/latest.jpg`;

  // Redirect to the public URL without cache-busting
  // The 5-minute revalidate allows edge caching while still getting updates
  return NextResponse.redirect(publicUrl);
}
