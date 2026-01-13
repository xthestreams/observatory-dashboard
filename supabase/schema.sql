-- ============================================================================
-- Observatory Dashboard - Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- CURRENT CONDITIONS TABLE
-- Single row, updated every time data comes in from the Pi
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS current_conditions (
    id INTEGER PRIMARY KEY DEFAULT 1,
    
    -- Weather station data
    temperature REAL,
    humidity REAL,
    pressure REAL,
    dewpoint REAL,
    wind_speed REAL,
    wind_gust REAL,
    wind_direction INTEGER,
    rain_rate REAL,
    
    -- Cloudwatcher data
    cloud_condition TEXT DEFAULT 'Unknown' 
        CHECK (cloud_condition IN ('Clear', 'Cloudy', 'VeryCloudy', 'Unknown')),
    rain_condition TEXT DEFAULT 'Unknown' 
        CHECK (rain_condition IN ('Dry', 'Wet', 'Rain', 'Unknown')),
    wind_condition TEXT DEFAULT 'Unknown' 
        CHECK (wind_condition IN ('Calm', 'Windy', 'VeryWindy', 'Unknown')),
    day_condition TEXT DEFAULT 'Unknown' 
        CHECK (day_condition IN ('Dark', 'Light', 'VeryLight', 'Unknown')),
    sky_temp REAL,
    ambient_temp REAL,
    
    -- SQM data
    sky_quality REAL,
    sqm_temperature REAL,
    
    -- Additional sensors (LoRa, etc.)
    lora_sensors JSONB,
    
    -- Timestamp
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure only one row
    CONSTRAINT single_row CHECK (id = 1)
);

-- Insert initial row
INSERT INTO current_conditions (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- HISTORICAL READINGS TABLE
-- Time-series data for graphs and analysis
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weather_readings (
    id BIGSERIAL PRIMARY KEY,
    
    -- Same fields as current_conditions
    temperature REAL,
    humidity REAL,
    pressure REAL,
    dewpoint REAL,
    wind_speed REAL,
    wind_gust REAL,
    wind_direction INTEGER,
    rain_rate REAL,
    cloud_condition TEXT DEFAULT 'Unknown',
    rain_condition TEXT DEFAULT 'Unknown',
    wind_condition TEXT DEFAULT 'Unknown',
    day_condition TEXT DEFAULT 'Unknown',
    sky_temp REAL,
    ambient_temp REAL,
    sky_quality REAL,
    sqm_temperature REAL,
    lora_sensors JSONB,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for time-series queries
CREATE INDEX IF NOT EXISTS idx_readings_created_at 
    ON weather_readings (created_at DESC);

-- Index for SQM graph queries
CREATE INDEX IF NOT EXISTS idx_readings_sqm 
    ON weather_readings (created_at DESC) 
    WHERE sky_quality IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS
ALTER TABLE current_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_readings ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read" ON current_conditions
    FOR SELECT USING (true);

CREATE POLICY "Allow public read" ON weather_readings
    FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Allow service write" ON current_conditions
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow service insert" ON weather_readings
    FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- REALTIME (for live updates)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE current_conditions REPLICA IDENTITY FULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- DATA CLEANUP (optional - keeps last 30 days)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_old_readings()
RETURNS void AS $$
BEGIN
    DELETE FROM weather_readings 
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- To run manually: SELECT cleanup_old_readings();
-- To schedule (requires pg_cron):
-- SELECT cron.schedule('cleanup', '0 3 * * *', 'SELECT cleanup_old_readings()');


-- ─────────────────────────────────────────────────────────────────────────────
-- SITE CONFIGURATION TABLE
-- Key-value store for dashboard settings (VirtualSky config, etc.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read" ON site_config
    FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY "Allow service write" ON site_config
    FOR ALL USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE BUCKET FOR IMAGES
-- Run this in Storage section or via SQL
-- ─────────────────────────────────────────────────────────────────────────────

-- Create storage bucket for allsky and satellite images
-- NOTE: This must be done via Supabase Dashboard > Storage > Create bucket
-- Bucket name: allsky-images
-- Public bucket: Yes (for serving images)
--
-- Or via SQL (requires storage schema access):
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('allsky-images', 'allsky-images', true)
-- ON CONFLICT (id) DO NOTHING;
--
-- Storage bucket structure:
-- allsky-images/
--   ├── latest.jpg           (current AllSky camera image)
--   ├── archive/             (timestamped AllSky images)
--   └── bom-satellite/       (BOM satellite and radar imagery)
--       ├── IDE00135.jpg     (Australia True Color)
--       ├── IDE00135-RADAR.jpg (Radar Composite)
--       ├── IDE00005.jpg     (Visible B&W)
--       ├── IDE00006.jpg     (Infrared B&W)
--       ├── IDE00153.jpg     (Hemisphere Full Disk)
--       └── IDRxx[1-4].gif   (Weather radar - xx=station code, 1-4=range)
--           e.g., IDR714.gif = Sydney 64km, IDR713.gif = Sydney 128km
