import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  // Direct query with no filters
  const { data, error } = await supabase
    .from("instruments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({
    data,
    error: error?.message || null,
    count: data?.length || 0,
  });
}
