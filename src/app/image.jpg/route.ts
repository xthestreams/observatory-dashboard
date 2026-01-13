import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const BUCKET_NAME = "allsky-images";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createServerClient();

    // Get a signed URL for the latest image
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl("latest.jpg", 300); // 5 minute expiry

    if (error || !data) {
      // Return a placeholder or 404
      return new NextResponse("Image not available", {
        status: 404,
        headers: {
          "Content-Type": "text/plain",
        }
      });
    }

    // Redirect to the signed URL
    return NextResponse.redirect(data.signedUrl);
  } catch (error) {
    console.error("Error fetching AllSky image:", error);
    return new NextResponse("Error fetching image", {
      status: 500,
      headers: {
        "Content-Type": "text/plain",
      }
    });
  }
}
