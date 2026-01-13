import { NextResponse } from "next/server";

const BUCKET_NAME = "allsky-images";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;

// Force dynamic rendering
export const dynamic = "force-dynamic";

export async function GET() {
  if (!SUPABASE_URL) {
    return new NextResponse(null, { status: 500 });
  }

  // Use public URL directly (bucket is public)
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/latest.jpg`;

  // Redirect to the public URL with cache-busting
  return NextResponse.redirect(`${publicUrl}?t=${Date.now()}`);
}
