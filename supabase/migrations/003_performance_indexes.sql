-- ============================================================================
-- MIGRATION: Performance Indexes and Materialized Views
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Date: 2026-01-22
-- Purpose: Add composite indexes and materialized views for query optimization
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: COMPOSITE INDEXES FOR INSTRUMENT READINGS
-- These optimize the most common query patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- Composite index for multi-instrument queries filtering by instrument + time
-- Used by: /api/current when fetching latest readings per instrument
CREATE INDEX IF NOT EXISTS idx_instrument_readings_composite
  ON instrument_readings(instrument_id, created_at DESC)
  WHERE is_outlier = false;

-- Index for outlier detection queries
-- Used by: outlier detection functions when comparing against recent readings
CREATE INDEX IF NOT EXISTS idx_readings_outliers
  ON instrument_readings(instrument_id, created_at DESC)
  WHERE is_outlier = true;

-- Index for instrument health queries
-- Used by: health monitoring to find instruments with recent readings
CREATE INDEX IF NOT EXISTS idx_instrument_last_reading
  ON instruments(status, last_reading_at DESC);

-- Index for time-range queries filtering by sky_quality
-- Used by: SQM history graph queries
CREATE INDEX IF NOT EXISTS idx_readings_sky_quality_time
  ON instrument_readings(created_at DESC)
  WHERE sky_quality IS NOT NULL AND is_outlier = false;

-- Index for weather history queries (temperature, humidity, etc.)
-- Used by: sparkline graphs
CREATE INDEX IF NOT EXISTS idx_readings_weather_time
  ON instrument_readings(created_at DESC)
  WHERE is_outlier = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: INDEXES FOR LEGACY WEATHER_READINGS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

-- Index for time-based queries and cleanup operations on legacy table
-- Note: Can't use partial index with NOW() as it's not immutable
CREATE INDEX IF NOT EXISTS idx_weather_readings_time
  ON weather_readings(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: MATERIALIZED VIEW FOR CURRENT SITE CONDITIONS
-- Pre-computed aggregates refreshed periodically
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop existing view if it exists (to recreate as materialized)
DROP MATERIALIZED VIEW IF EXISTS site_conditions_current;

-- Create materialized view for site-wide current conditions
-- This pre-computes the averages that /api/current needs
CREATE MATERIALIZED VIEW site_conditions_current AS
WITH latest_per_instrument AS (
    SELECT DISTINCT ON (ir.instrument_id)
        ir.*,
        i.include_in_average,
        i.instrument_type
    FROM instrument_readings ir
    JOIN instruments i ON ir.instrument_id = i.id
    WHERE ir.created_at > NOW() - INTERVAL '15 minutes'
      AND ir.is_outlier = false
      AND i.status = 'active'
      AND i.include_in_average = true
    ORDER BY ir.instrument_id, ir.created_at DESC
)
SELECT
    ROUND(AVG(temperature)::numeric, 1)::real as temperature,
    ROUND(AVG(humidity)::numeric, 0)::real as humidity,
    ROUND(AVG(pressure)::numeric, 1)::real as pressure,
    ROUND(AVG(dewpoint)::numeric, 1)::real as dewpoint,
    ROUND(AVG(wind_speed)::numeric, 1)::real as wind_speed,
    ROUND(MAX(wind_gust)::numeric, 1)::real as wind_gust,
    MODE() WITHIN GROUP (ORDER BY wind_direction)::integer as wind_direction,
    ROUND(AVG(rain_rate)::numeric, 2)::real as rain_rate,
    ROUND(AVG(sky_temp)::numeric, 1)::real as sky_temp,
    ROUND(AVG(ambient_temp)::numeric, 1)::real as ambient_temp,
    ROUND(AVG(sky_quality)::numeric, 2)::real as sky_quality,
    ROUND(AVG(sqm_temperature)::numeric, 1)::real as sqm_temperature,
    CASE
        WHEN bool_or(cloud_condition = 'VeryCloudy') THEN 'VeryCloudy'
        WHEN bool_or(cloud_condition = 'Cloudy') THEN 'Cloudy'
        WHEN bool_or(cloud_condition = 'Clear') THEN 'Clear'
        ELSE 'Unknown'
    END as cloud_condition,
    CASE
        WHEN bool_or(rain_condition = 'Rain') THEN 'Rain'
        WHEN bool_or(rain_condition = 'Wet') THEN 'Wet'
        WHEN bool_or(rain_condition = 'Dry') THEN 'Dry'
        ELSE 'Unknown'
    END as rain_condition,
    CASE
        WHEN bool_or(wind_condition = 'VeryWindy') THEN 'VeryWindy'
        WHEN bool_or(wind_condition = 'Windy') THEN 'Windy'
        WHEN bool_or(wind_condition = 'Calm') THEN 'Calm'
        ELSE 'Unknown'
    END as wind_condition,
    CASE
        WHEN bool_or(day_condition = 'VeryLight') THEN 'VeryLight'
        WHEN bool_or(day_condition = 'Light') THEN 'Light'
        WHEN bool_or(day_condition = 'Dark') THEN 'Dark'
        ELSE 'Unknown'
    END as day_condition,
    MAX(created_at) as updated_at,
    COUNT(*)::int as instrument_count,
    NOW() as refreshed_at
FROM latest_per_instrument;

-- Index on the materialized view for quick lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_conditions_current_singleton
  ON site_conditions_current(refreshed_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4: MATERIALIZED VIEW FOR SQM HISTORY (24 hours)
-- Pre-computed SQM readings for the graph
-- ─────────────────────────────────────────────────────────────────────────────

DROP MATERIALIZED VIEW IF EXISTS sqm_history_24h;

CREATE MATERIALIZED VIEW sqm_history_24h AS
SELECT
    ir.created_at,
    ir.sky_quality,
    ir.instrument_id,
    i.code as instrument_code,
    ROW_NUMBER() OVER (PARTITION BY ir.instrument_id ORDER BY ir.created_at DESC) as rn
FROM instrument_readings ir
JOIN instruments i ON ir.instrument_id = i.id
WHERE ir.created_at > NOW() - INTERVAL '24 hours'
  AND ir.sky_quality IS NOT NULL
  AND ir.is_outlier = false;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sqm_history_24h_time
  ON sqm_history_24h(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sqm_history_24h_instrument
  ON sqm_history_24h(instrument_code, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5: REFRESH FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- Function to refresh site conditions (call every minute)
CREATE OR REPLACE FUNCTION refresh_site_conditions()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY site_conditions_current;
EXCEPTION
    WHEN OTHERS THEN
        -- If concurrent refresh fails (e.g., no unique index), do a regular refresh
        REFRESH MATERIALIZED VIEW site_conditions_current;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh SQM history (call every 5 minutes)
CREATE OR REPLACE FUNCTION refresh_sqm_history()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW sqm_history_24h;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 6: INITIAL REFRESH
-- ─────────────────────────────────────────────────────────────────────────────

-- Do an initial refresh of the materialized views
SELECT refresh_site_conditions();
SELECT refresh_sqm_history();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 7: SCHEDULING (requires pg_cron extension)
-- Uncomment these if pg_cron is enabled in your Supabase project
-- ─────────────────────────────────────────────────────────────────────────────

-- Schedule refresh every minute for site conditions
-- SELECT cron.schedule('refresh-site-conditions', '* * * * *', 'SELECT refresh_site_conditions()');

-- Schedule refresh every 5 minutes for SQM history
-- SELECT cron.schedule('refresh-sqm-history', '*/5 * * * *', 'SELECT refresh_sqm_history()');

-- ─────────────────────────────────────────────────────────────────────────────
-- USAGE NOTES
-- ─────────────────────────────────────────────────────────────────────────────

-- To manually refresh the materialized views:
--   SELECT refresh_site_conditions();
--   SELECT refresh_sqm_history();
--
-- To query the current site conditions:
--   SELECT * FROM site_conditions_current;
--
-- To query SQM history:
--   SELECT * FROM sqm_history_24h WHERE rn <= 48 ORDER BY created_at DESC;
--
-- If pg_cron is not available, you can set up an external scheduler
-- (e.g., Vercel Cron, GitHub Actions) to call the refresh functions
-- via Supabase's REST API or Edge Functions.
