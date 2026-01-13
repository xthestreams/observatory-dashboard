-- ============================================================================
-- MIGRATION: Multi-Instrument Support
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: NEW TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- Instruments registry
CREATE TABLE IF NOT EXISTS instruments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(128) NOT NULL,
    instrument_type VARCHAR(32) NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '[]',
    include_in_average BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    status VARCHAR(16) DEFAULT 'active'
        CHECK (status IN ('active', 'degraded', 'offline', 'maintenance')),
    last_reading_at TIMESTAMPTZ,
    consecutive_outliers INTEGER DEFAULT 0,
    location_description TEXT,
    calibration_offsets JSONB DEFAULT '{}',
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw readings from each instrument
CREATE TABLE IF NOT EXISTS instrument_readings (
    id BIGSERIAL PRIMARY KEY,
    instrument_id UUID NOT NULL REFERENCES instruments(id),
    temperature REAL,
    humidity REAL,
    pressure REAL,
    dewpoint REAL,
    wind_speed REAL,
    wind_gust REAL,
    wind_direction INTEGER,
    rain_rate REAL,
    sky_temp REAL,
    ambient_temp REAL,
    sky_quality REAL,
    sqm_temperature REAL,
    cloud_condition TEXT,
    rain_condition TEXT,
    wind_condition TEXT,
    day_condition TEXT,
    is_outlier BOOLEAN DEFAULT false,
    outlier_reason TEXT,
    raw_values JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_instrument_readings_time
    ON instrument_readings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instrument_readings_instrument_time
    ON instrument_readings(instrument_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_instrument_readings_sqm
    ON instrument_readings(created_at DESC)
    WHERE sky_quality IS NOT NULL AND is_outlier = false;
CREATE INDEX IF NOT EXISTS idx_instruments_status
    ON instruments(status) WHERE status != 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: SITE CONDITIONS VIEW (Aggregated averages)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW site_conditions AS
WITH latest_per_instrument AS (
    SELECT DISTINCT ON (ir.instrument_id)
        ir.*,
        i.include_in_average,
        i.priority,
        i.instrument_type
    FROM instrument_readings ir
    JOIN instruments i ON ir.instrument_id = i.id
    WHERE ir.created_at > NOW() - INTERVAL '10 minutes'
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
    COUNT(*)::int as instrument_count
FROM latest_per_instrument;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3: OUTLIER DETECTION FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

-- Generic outlier detection using Z-score
CREATE OR REPLACE FUNCTION check_outlier(
    p_instrument_id UUID,
    p_metric TEXT,
    p_value REAL,
    p_zscore_threshold REAL DEFAULT 3.0
)
RETURNS TABLE(is_outlier BOOLEAN, reason TEXT) AS $$
DECLARE
    v_mean REAL;
    v_stddev REAL;
    v_zscore REAL;
    v_instrument_type TEXT;
BEGIN
    SELECT instrument_type INTO v_instrument_type
    FROM instruments WHERE id = p_instrument_id;

    EXECUTE format('
        SELECT AVG(r.%I), STDDEV(r.%I)
        FROM instrument_readings r
        JOIN instruments i ON r.instrument_id = i.id
        WHERE r.created_at > NOW() - INTERVAL ''1 hour''
          AND r.instrument_id != $1
          AND r.is_outlier = false
          AND i.instrument_type = $2
          AND r.%I IS NOT NULL
    ', p_metric, p_metric, p_metric)
    INTO v_mean, v_stddev
    USING p_instrument_id, v_instrument_type;

    IF v_mean IS NULL OR v_stddev IS NULL OR v_stddev < 0.001 THEN
        RETURN QUERY SELECT false, NULL::TEXT;
        RETURN;
    END IF;

    v_zscore := ABS(p_value - v_mean) / v_stddev;

    IF v_zscore > p_zscore_threshold THEN
        RETURN QUERY SELECT true,
            format('Z-score %.2f > %.1f (mean=%.2f, stddev=%.2f)',
                   v_zscore, p_zscore_threshold, v_mean, v_stddev);
    ELSE
        RETURN QUERY SELECT false, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- SQM-specific outlier detection (tighter threshold)
CREATE OR REPLACE FUNCTION check_sqm_outlier(
    p_instrument_id UUID,
    p_value REAL
)
RETURNS TABLE(is_outlier BOOLEAN, reason TEXT) AS $$
DECLARE
    v_peer_values REAL[];
    v_mean REAL;
    v_diff REAL;
BEGIN
    SELECT ARRAY_AGG(ir.sky_quality)
    INTO v_peer_values
    FROM instrument_readings ir
    JOIN instruments i ON ir.instrument_id = i.id
    WHERE ir.created_at > NOW() - INTERVAL '5 minutes'
      AND ir.instrument_id != p_instrument_id
      AND i.instrument_type = 'sqm'
      AND ir.sky_quality IS NOT NULL
      AND ir.is_outlier = false;

    IF v_peer_values IS NULL OR array_length(v_peer_values, 1) < 1 THEN
        RETURN QUERY SELECT false, NULL::TEXT;
        RETURN;
    END IF;

    v_mean := (SELECT AVG(x) FROM unnest(v_peer_values) x);
    v_diff := ABS(p_value - v_mean);

    IF v_diff > 1.0 THEN
        RETURN QUERY SELECT true,
            format('SQM %.2f differs from peer mean %.2f by %.2f mag',
                   p_value, v_mean, v_diff);
    ELSE
        RETURN QUERY SELECT false, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4: INSTRUMENT HEALTH TRIGGER
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_instrument_health()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_outlier THEN
        UPDATE instruments
        SET consecutive_outliers = consecutive_outliers + 1,
            status = CASE
                WHEN consecutive_outliers + 1 >= 10 THEN 'offline'
                WHEN consecutive_outliers + 1 >= 5 THEN 'degraded'
                ELSE status
            END,
            updated_at = NOW()
        WHERE id = NEW.instrument_id;
    ELSE
        UPDATE instruments
        SET consecutive_outliers = 0,
            last_reading_at = NEW.created_at,
            status = CASE WHEN status IN ('degraded', 'offline') THEN 'active' ELSE status END,
            updated_at = NOW()
        WHERE id = NEW.instrument_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_instrument_health ON instrument_readings;
CREATE TRIGGER trg_update_instrument_health
AFTER INSERT ON instrument_readings
FOR EACH ROW EXECUTE FUNCTION update_instrument_health();

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5: ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE instrument_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read instruments" ON instruments;
DROP POLICY IF EXISTS "Allow public read instrument_readings" ON instrument_readings;
DROP POLICY IF EXISTS "Allow service write instruments" ON instruments;
DROP POLICY IF EXISTS "Allow service write instrument_readings" ON instrument_readings;

CREATE POLICY "Allow public read instruments" ON instruments FOR SELECT USING (true);
CREATE POLICY "Allow public read instrument_readings" ON instrument_readings FOR SELECT USING (true);
CREATE POLICY "Allow service write instruments" ON instruments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write instrument_readings" ON instrument_readings FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 6: DEFAULT INSTRUMENT & DATA BACKFILL
-- ─────────────────────────────────────────────────────────────────────────────

-- Create default instrument for legacy/backward compatibility
INSERT INTO instruments (code, name, instrument_type, capabilities, priority)
VALUES ('default', 'Legacy Single Instrument', 'weather_station',
        '["temperature", "humidity", "pressure", "dewpoint", "wind_speed", "wind_gust", "wind_direction", "rain_rate", "sky_temp", "ambient_temp", "sky_quality", "sqm_temperature", "cloud_condition", "rain_condition", "wind_condition", "day_condition"]',
        0)
ON CONFLICT (code) DO NOTHING;

-- Backfill historical data (run this after creating the default instrument)
INSERT INTO instrument_readings (
    instrument_id,
    temperature, humidity, pressure, dewpoint,
    wind_speed, wind_gust, wind_direction, rain_rate,
    sky_temp, ambient_temp, sky_quality, sqm_temperature,
    cloud_condition, rain_condition, wind_condition, day_condition,
    is_outlier, created_at
)
SELECT
    (SELECT id FROM instruments WHERE code = 'default'),
    temperature, humidity, pressure, dewpoint,
    wind_speed, wind_gust, wind_direction, rain_rate,
    sky_temp, ambient_temp, sky_quality, sqm_temperature,
    cloud_condition, rain_condition, wind_condition, day_condition,
    false,
    created_at
FROM weather_readings
WHERE NOT EXISTS (
    SELECT 1 FROM instrument_readings ir
    WHERE ir.created_at = weather_readings.created_at
);

-- Update last_reading_at for default instrument
UPDATE instruments
SET last_reading_at = (
    SELECT MAX(created_at) FROM instrument_readings
    WHERE instrument_id = instruments.id
)
WHERE code = 'default';

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 7: CLEANUP FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_old_instrument_readings()
RETURNS void AS $$
BEGIN
    DELETE FROM instrument_readings
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
