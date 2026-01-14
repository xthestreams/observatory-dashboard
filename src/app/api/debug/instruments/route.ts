import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServiceClient();

  // Get all instruments with expected column
  const { data: instruments, error: instError } = await supabase
    .from("instruments")
    .select("code, name, expected, collector_id, status, last_reading_at, updated_at")
    .order("updated_at", { ascending: false });

  // Get site_config for collector_last_config
  const { data: configData, error: configError } = await supabase
    .from("site_config")
    .select("*")
    .eq("key", "collector_last_config")
    .single();

  return NextResponse.json({
    instruments: instruments || [],
    instruments_error: instError?.message || null,
    config: configData || null,
    config_error: configError?.message || null,
    expected_count: (instruments || []).filter(i => i.expected === true).length,
  });
}
