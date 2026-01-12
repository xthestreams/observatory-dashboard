import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const BUCKET_NAME = "allsky-images";

export async function GET() {
  try {
    const supabase = createServerClient();

    // Get a signed URL for the latest image
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl("latest.jpg", 300); // 5 minute expiry

    if (error || !data) {
      return new NextResponse(null, { status: 404 });
    }

    // Redirect to the signed URL
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    console.error("Error fetching AllSky image:", error);
    return new NextResponse(null, { status: 500 });
  }
}
