import { NextResponse } from "next/server";
import { createServiceClient, createServerClient } from "@/lib/supabase";
import { fetchTelemetryHealth } from "@/lib/instruments";

export const dynamic = "force-dynamic";

export async function GET() {
  const serviceClient = createServiceClient();
  const serverClient = createServerClient();

  // Get all instruments with expected column using service client
  const { data: instruments, error: instError } = await serviceClient
    .from("instruments")
    .select("code, name, expected, collector_id, status, last_reading_at, updated_at")
    .order("updated_at", { ascending: false });

  // Also run the exact same query as fetchTelemetryHealth uses
  const { data: expectedInstruments, error: expectedError } = await serviceClient
    .from("instruments")
    .select("code, name, status, last_reading_at, consecutive_outliers, expected")
    .eq("expected", true);

  // Get site_config for collector_last_config
  const { data: configData, error: configError } = await serviceClient
    .from("site_config")
    .select("*")
    .eq("key", "collector_last_config")
    .single();

  // Also fetch telemetryHealth to compare
  let telemetryHealth = null;
  let telemetryError = null;
  try {
    telemetryHealth = await fetchTelemetryHealth(serviceClient);
  } catch (e) {
    telemetryError = (e as Error).message;
  }

  return NextResponse.json({
    instruments: instruments || [],
    instruments_error: instError?.message || null,
    expected_instruments_raw: expectedInstruments || [],
    expected_instruments_error: expectedError?.message || null,
    config: configData || null,
    config_error: configError?.message || null,
    expected_count: (instruments || []).filter(i => i.expected === true).length,
    expected_from_query: expectedInstruments?.length || 0,
    telemetryHealth,
    telemetryError,
  });
}
