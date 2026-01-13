# Multi-Instrument Migration Plan

This document outlines the plan to migrate the Observatory Dashboard from a single-instrument architecture to a multi-instrument architecture with averaging and outlier detection.

## Overview

**Goal**: Support multiple instruments of the same type (e.g., multiple SQMs, multiple weather stations) with:
- Per-instrument raw data storage
- Configurable inclusion in site averages
- Automatic outlier detection
- Instrument health tracking and auto-disable

**Migration Strategy**: Phased approach with backward compatibility maintained throughout.

---

## Phase 1: Database Schema Migration

### 1.1 Create New Tables

Add these tables alongside existing ones (no breaking changes yet):

```sql
-- instruments: Registry of all data sources
CREATE TABLE instruments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(32) UNIQUE NOT NULL,           -- 'sqm-north', 'wx-davis-roof'
    name VARCHAR(128) NOT NULL,                  -- 'SQM-LU (North Pier)'
    instrument_type VARCHAR(32) NOT NULL,        -- 'sqm', 'weather_station', 'cloudwatcher'
    capabilities JSONB NOT NULL DEFAULT '[]',    -- ['temperature', 'humidity', 'sky_quality']
    include_in_average BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,                  -- Higher = preferred
    status VARCHAR(16) DEFAULT 'active'
        CHECK (status IN ('active', 'degraded', 'offline', 'maintenance')),
    last_reading_at TIMESTAMPTZ,
    consecutive_outliers INTEGER DEFAULT 0,
    location_description TEXT,
    calibration_offsets JSONB DEFAULT '{}',      -- {"temperature": -0.5}
    config JSONB DEFAULT '{}',                   -- Instrument-specific config
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- instrument_readings: Raw readings from each instrument
CREATE TABLE instrument_readings (
    id BIGSERIAL PRIMARY KEY,
    instrument_id UUID NOT NULL REFERENCES instruments(id),

    -- All possible measurements (sparse - each instrument fills what it can)
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

    -- Quality tracking
    is_outlier BOOLEAN DEFAULT false,
    outlier_reason TEXT,
    raw_values JSONB,                            -- Original uncalibrated values

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_instrument_readings_time
    ON instrument_readings(created_at DESC);
CREATE INDEX idx_instrument_readings_instrument_time
    ON instrument_readings(instrument_id, created_at DESC);
CREATE INDEX idx_instrument_readings_sqm
    ON instrument_readings(created_at DESC)
    WHERE sky_quality IS NOT NULL AND is_outlier = false;
```

### 1.2 Create Aggregation View

```sql
-- site_conditions: Computed averages from healthy instruments
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
    -- Numeric averages
    ROUND(AVG(temperature)::numeric, 1) as temperature,
    ROUND(AVG(humidity)::numeric, 0) as humidity,
    ROUND(AVG(pressure)::numeric, 1) as pressure,
    ROUND(AVG(dewpoint)::numeric, 1) as dewpoint,
    ROUND(AVG(wind_speed)::numeric, 1) as wind_speed,
    ROUND(MAX(wind_gust)::numeric, 1) as wind_gust,
    MODE() WITHIN GROUP (ORDER BY wind_direction) as wind_direction,
    ROUND(AVG(rain_rate)::numeric, 2) as rain_rate,
    ROUND(AVG(sky_temp)::numeric, 1) as sky_temp,
    ROUND(AVG(ambient_temp)::numeric, 1) as ambient_temp,
    ROUND(AVG(sky_quality)::numeric, 2) as sky_quality,
    ROUND(AVG(sqm_temperature)::numeric, 1) as sqm_temperature,

    -- Conditions: take most conservative (worst case)
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

    -- Metadata
    MAX(created_at) as updated_at,
    COUNT(*)::int as instrument_count
FROM latest_per_instrument;
```

### 1.3 Outlier Detection Functions

```sql
-- Generic outlier detection using Z-score against peer instruments
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
    -- Get instrument type
    SELECT instrument_type INTO v_instrument_type
    FROM instruments WHERE id = p_instrument_id;

    -- Calculate stats from peer instruments (same type, last hour, non-outliers)
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

    -- Not enough data for comparison
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

-- SQM-specific outlier detection (tighter thresholds)
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
    -- Get concurrent readings from other SQMs (within last 5 min)
    SELECT ARRAY_AGG(ir.sky_quality)
    INTO v_peer_values
    FROM instrument_readings ir
    JOIN instruments i ON ir.instrument_id = i.id
    WHERE ir.created_at > NOW() - INTERVAL '5 minutes'
      AND ir.instrument_id != p_instrument_id
      AND i.instrument_type = 'sqm'
      AND ir.sky_quality IS NOT NULL
      AND ir.is_outlier = false;

    -- Need at least 1 other SQM
    IF v_peer_values IS NULL OR array_length(v_peer_values, 1) < 1 THEN
        RETURN QUERY SELECT false, NULL::TEXT;
        RETURN;
    END IF;

    v_mean := (SELECT AVG(x) FROM unnest(v_peer_values) x);
    v_diff := ABS(p_value - v_mean);

    -- SQM readings should agree within ~1.0 mag/arcsec²
    IF v_diff > 1.0 THEN
        RETURN QUERY SELECT true,
            format('SQM %.2f differs from peer mean %.2f by %.2f mag',
                   p_value, v_mean, v_diff);
    ELSE
        RETURN QUERY SELECT false, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;
```

### 1.4 Instrument Health Trigger

```sql
-- Auto-update instrument health based on outlier patterns
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

CREATE TRIGGER trg_update_instrument_health
AFTER INSERT ON instrument_readings
FOR EACH ROW EXECUTE FUNCTION update_instrument_health();
```

### 1.5 RLS Policies

```sql
ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE instrument_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON instruments FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON instrument_readings FOR SELECT USING (true);
CREATE POLICY "Allow service write" ON instruments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service write" ON instrument_readings FOR ALL USING (true) WITH CHECK (true);
```

### 1.6 Data Cleanup

```sql
CREATE OR REPLACE FUNCTION cleanup_old_instrument_readings()
RETURNS void AS $$
BEGIN
    DELETE FROM instrument_readings
    WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
```

---

## Phase 2: API Changes

### 2.1 New Ingest Endpoint Structure

**File**: `src/app/api/ingest/data/route.ts`

The ingest endpoint will accept an optional `instrument_code` field:

```typescript
// New payload format (backward compatible)
interface IngestPayload {
  instrument_code?: string;  // NEW: identifies the instrument
  // ... existing fields
  temperature?: number;
  humidity?: number;
  // etc.
}
```

**Behavior**:
- If `instrument_code` is provided → insert into `instrument_readings` with that instrument
- If `instrument_code` is missing → use legacy `"default"` instrument (backward compatibility)
- Auto-register unknown instruments on first use (with sensible defaults)

### 2.2 Auto-Registration Logic

When an unknown `instrument_code` is received, auto-register with inferred defaults:

```typescript
async function getOrCreateInstrument(supabase: SupabaseClient, code: string, data: IngestPayload) {
  // Try to find existing
  const { data: existing } = await supabase
    .from('instruments')
    .select('id')
    .eq('code', code)
    .single();

  if (existing) return existing.id;

  // Infer type from data fields present
  const type = inferInstrumentType(data);
  const capabilities = inferCapabilities(data);

  const { data: created, error } = await supabase
    .from('instruments')
    .insert({
      code,
      name: code,  // Can be updated later via admin
      instrument_type: type,
      capabilities,
      include_in_average: true,
      priority: 0,
      status: 'active'
    })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

function inferInstrumentType(data: IngestPayload): string {
  if (data.sky_quality !== undefined) return 'sqm';
  if (data.cloud_condition !== undefined || data.sky_temp !== undefined) return 'cloudwatcher';
  if (data.temperature !== undefined || data.humidity !== undefined) return 'weather_station';
  return 'unknown';
}

function inferCapabilities(data: IngestPayload): string[] {
  const caps: string[] = [];
  if (data.temperature !== undefined) caps.push('temperature');
  if (data.humidity !== undefined) caps.push('humidity');
  if (data.pressure !== undefined) caps.push('pressure');
  if (data.wind_speed !== undefined) caps.push('wind_speed');
  if (data.sky_quality !== undefined) caps.push('sky_quality');
  if (data.cloud_condition !== undefined) caps.push('cloud_condition');
  // ... etc
  return caps;
}
```

### 2.2 Updated Current API Response

**File**: `src/app/api/current/route.ts`

New response structure:

```typescript
interface ApiResponse {
  // Site-averaged values (what dashboard shows by default)
  current: WeatherData;

  // Per-instrument breakdown (optional, for detailed view)
  instruments?: {
    [code: string]: {
      data: Partial<WeatherData>;
      status: 'active' | 'degraded' | 'offline' | 'maintenance';
      lastReading: string;
      isOutlier: boolean;
    };
  };

  // SQM history (can filter by instrument)
  sqmHistory: HistoricalReading[];

  // Instrument metadata
  instrumentCount?: number;
}
```

### 2.3 New Admin Endpoints

```
GET  /api/instruments           - List all instruments
POST /api/instruments           - Register new instrument
PUT  /api/instruments/:code     - Update instrument config
GET  /api/instruments/:code/history - Get instrument-specific history
```

---

## Phase 3: TypeScript Types

### 3.1 New Type Definitions

**File**: `src/types/weather.ts`

```typescript
// Instrument definition
export interface Instrument {
  id: string;
  code: string;
  name: string;
  type: InstrumentType;
  capabilities: string[];
  includeInAverage: boolean;
  priority: number;
  status: InstrumentStatus;
  lastReadingAt: string | null;
  consecutiveOutliers: number;
  locationDescription?: string;
  calibrationOffsets?: Record<string, number>;
}

export type InstrumentType = 'sqm' | 'weather_station' | 'cloudwatcher' | 'allsky';
export type InstrumentStatus = 'active' | 'degraded' | 'offline' | 'maintenance';

// Per-instrument reading
export interface InstrumentReading extends Partial<WeatherData> {
  instrumentId: string;
  instrumentCode: string;
  isOutlier: boolean;
  outlierReason?: string;
  createdAt: string;
}

// Extended API response
export interface ApiResponse {
  current: WeatherData;
  instruments?: Record<string, InstrumentSummary>;
  sqmHistory: HistoricalReading[];
  instrumentCount?: number;
}

export interface InstrumentSummary {
  data: Partial<WeatherData>;
  status: InstrumentStatus;
  lastReading: string;
  isOutlier: boolean;
}

// Historical reading with instrument tracking
export interface HistoricalReading {
  time: string;
  timestamp: string;
  sky_quality: number;
  moon_altitude?: number;
  instrumentCode?: string;  // NEW: which instrument
}
```

---

## Phase 4: Collector Changes

### 4.1 Configuration Updates

**File**: `raspberry-pi/.env`

```bash
# Existing config...

# NEW: Instrument identifiers
INSTRUMENT_CODE_SQM=sqm-primary
INSTRUMENT_CODE_WEATHERLINK=wx-davis-roof
INSTRUMENT_CODE_CLOUDWATCHER=cw-solo
INSTRUMENT_CODE_ALLSKY=allsky-main

# For multiple SQMs (future)
# SQM_INSTRUMENTS=sqm-north:192.168.1.100:10001,sqm-south:192.168.1.101:10001
```

### 4.2 Data Store Refactoring

**File**: `raspberry-pi/collector.py`

Change from single global store to instrument-keyed stores:

```python
class MultiInstrumentDataStore:
    """Thread-safe store for multiple instrument readings."""

    def __init__(self):
        self._instruments: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def update(self, instrument_code: str, **kwargs) -> None:
        with self._lock:
            if instrument_code not in self._instruments:
                self._instruments[instrument_code] = {}
            self._instruments[instrument_code].update(kwargs)
            self._instruments[instrument_code]["timestamp"] = datetime.utcnow().isoformat()

    def get(self, instrument_code: str) -> Dict[str, Any]:
        with self._lock:
            return self._instruments.get(instrument_code, {}).copy()

    def get_all(self) -> Dict[str, Dict[str, Any]]:
        with self._lock:
            return {k: v.copy() for k, v in self._instruments.items()}
```

### 4.3 Push Function Update

```python
def push_data():
    """Push data for all instruments."""
    api_url = CONFIG["remote_api"]
    api_key = CONFIG["api_key"]
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    while True:
        try:
            all_data = data_store.get_all()

            for instrument_code, data in all_data.items():
                if not data.get("timestamp"):
                    continue  # Skip instruments with no data

                payload = {
                    "instrument_code": instrument_code,
                    **data
                }

                response = requests.post(
                    f"{api_url}/data",
                    json=payload,
                    headers=headers,
                    timeout=30,
                )

                if response.ok:
                    logger.info(f"Pushed {instrument_code} data")
                else:
                    logger.warning(f"Push failed for {instrument_code}: {response.status_code}")

        except Exception as e:
            logger.error(f"Push error: {e}")

        time.sleep(CONFIG["push_interval"])
```

---

## Phase 5: Frontend Changes

### 5.1 Dashboard Updates

**File**: `src/app/page.tsx`

- Default view shows site-averaged values (unchanged UX)
- **Clickable measurements**: Each stat card becomes clickable
- **Click behavior**: Opens modal/drawer showing per-instrument breakdown
- **Failure banner**: Alert banner at top when any instrument is degraded/offline

### 5.2 Instrument Failure Banner

**File**: `src/components/InstrumentAlert.tsx` (new)

```tsx
interface InstrumentAlertProps {
  failedInstruments: Array<{
    code: string;
    name: string;
    status: 'degraded' | 'offline';
    lastReading: string;
  }>;
}

// Displays a dismissible banner at top of dashboard:
// "⚠️ 2 instruments need attention: SQM-North (offline since 2h ago), WX-Shed (degraded)"
// Clicking opens the instrument detail modal
```

### 5.3 Clickable Measurement Cards

**File**: `src/components/WeatherStat.tsx` (modify)

```tsx
interface WeatherStatProps {
  // ... existing props
  onClick?: () => void;  // NEW: click handler
  hasMultipleSources?: boolean;  // NEW: show indicator that more data available
}

// When hasMultipleSources is true, show subtle indicator (e.g., small badge "3")
// indicating how many instruments contribute to this measurement
```

### 5.4 Instrument Detail Modal

**File**: `src/components/InstrumentDetailModal.tsx` (new)

```tsx
interface InstrumentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  metric: string;  // 'temperature', 'sky_quality', etc.
  instruments: Array<{
    code: string;
    name: string;
    value: number | null;
    status: InstrumentStatus;
    isOutlier: boolean;
    lastReading: string;
  }>;
  siteAverage: number | null;
}

// Modal content:
// ┌─────────────────────────────────────────────────┐
// │ Temperature                              [X]    │
// ├─────────────────────────────────────────────────┤
// │ Site Average: 18.5°C                           │
// │ ─────────────────────────────────────────────── │
// │ ● WX-Davis-Roof     18.7°C    ✓ active         │
// │ ● WX-Ecowitt-Shed   18.3°C    ✓ active         │
// │ ○ WX-Old-Sensor     22.1°C    ⚠️ outlier       │
// │                               (excluded)        │
// └─────────────────────────────────────────────────┘
```

### 5.5 SQM Graph Enhancement

**File**: `src/components/SQMGraph.tsx`

- Default: Single line showing site average
- Toggle button: "Show individual instruments"
- When toggled: Multiple colored lines, one per SQM
- Outlier readings shown as hollow/different markers
- Legend shows instrument names and current status

```tsx
interface SQMGraphProps {
  history: HistoricalReading[];  // Site average history
  instrumentHistory?: Record<string, HistoricalReading[]>;  // Per-instrument
  showIndividual?: boolean;
  onToggleIndividual?: () => void;
}
```

### 5.6 Updated API Response for Frontend

**File**: `src/types/weather.ts`

```typescript
export interface ApiResponse {
  // Site-averaged current conditions
  current: WeatherData;

  // SQM history (site average)
  sqmHistory: HistoricalReading[];

  // Per-instrument current values (for detail modal)
  instrumentReadings?: Record<string, InstrumentReading>;

  // Failed instruments (for alert banner)
  failedInstruments?: FailedInstrument[];

  // Metadata
  instrumentCount?: number;
}

export interface FailedInstrument {
  code: string;
  name: string;
  status: 'degraded' | 'offline';
  lastReadingAt: string;
  consecutiveOutliers: number;
}

export interface InstrumentReading {
  instrumentCode: string;
  instrumentName: string;
  instrumentType: string;
  status: InstrumentStatus;
  isOutlier: boolean;
  outlierReason?: string;
  lastReadingAt: string;
  // Actual values (sparse - only what this instrument measures)
  temperature?: number;
  humidity?: number;
  pressure?: number;
  sky_quality?: number;
  // ... etc
}
```

### 5.7 State Management

**File**: `src/app/page.tsx`

```tsx
// New state for instrument features
const [instrumentReadings, setInstrumentReadings] = useState<Record<string, InstrumentReading>>({});
const [failedInstruments, setFailedInstruments] = useState<FailedInstrument[]>([]);
const [selectedMetric, setSelectedMetric] = useState<string | null>(null);  // For modal
const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

// Click handler for measurement cards
const handleMetricClick = (metric: string) => {
  setSelectedMetric(metric);
  setIsDetailModalOpen(true);
};

// Filter instruments that measure the selected metric
const getInstrumentsForMetric = (metric: string) => {
  return Object.values(instrumentReadings).filter(
    ir => ir[metric as keyof InstrumentReading] !== undefined
  );
};
```

---

## Phase 6: Migration Execution

### Step 1: Database Migration (Non-Breaking)
1. Run schema to create new tables (`instruments`, `instrument_readings`)
2. Create views and functions
3. Create default instrument: `INSERT INTO instruments (code, name, instrument_type, capabilities) VALUES ('default', 'Legacy Single Instrument', 'weather_station', '["*"]')`
4. Verify with `SELECT * FROM instruments`

### Step 2: Historical Data Backfill
1. Get the default instrument ID
2. Backfill all existing `weather_readings` into `instrument_readings`:

```sql
-- Backfill historical data from weather_readings to instrument_readings
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
    false,  -- is_outlier (assume historical data is valid)
    created_at
FROM weather_readings
ORDER BY created_at;

-- Verify count matches
SELECT
    (SELECT COUNT(*) FROM weather_readings) as old_count,
    (SELECT COUNT(*) FROM instrument_readings) as new_count;
```

3. Update instrument's last_reading_at:
```sql
UPDATE instruments
SET last_reading_at = (SELECT MAX(created_at) FROM instrument_readings WHERE instrument_id = instruments.id)
WHERE code = 'default';
```

### Step 3: API Migration (Backward Compatible)
1. Update `/api/ingest/data` to check for `instrument_code`
2. If present → new flow with auto-registration; if absent → use 'default' instrument
3. Update `/api/current` to query `site_conditions` view
4. Add `failedInstruments` array to API response for dashboard alerts
5. Keep existing `current_conditions` table updated for rollback safety

### Step 4: Collector Migration (Per-Pi)
1. Update `.env` with instrument codes
2. Deploy updated `collector.py`
3. Verify data flows to new tables

### Step 5: Frontend Migration
1. Add instrument failure banner at top of dashboard
2. Make measurement cards clickable to show per-instrument breakdown
3. Add modal/drawer component for instrument details
4. SQM graph shows site average with option to toggle individual traces

### Step 6: Cleanup (After Validation)
1. Deprecate `current_conditions` table
2. Deprecate `weather_readings` table
3. Remove backward compatibility code
4. Update documentation

---

## Rollback Plan

At any phase, rollback is possible:

- **Phase 1**: Drop new tables (no impact on existing system)
- **Phase 2**: Revert API routes (old tables still work)
- **Phase 3**: Revert type changes (compile-time only)
- **Phase 4**: Revert collector (old format still accepted)
- **Phase 5**: Revert frontend (cosmetic only)

---

## Testing Strategy

### Unit Tests
- Outlier detection functions
- Aggregation logic
- API payload validation

### Integration Tests
- Collector → API → Database flow
- Multi-instrument concurrent writes
- Outlier flagging and instrument health updates

### Manual Testing
- Register 2+ SQM instruments
- Send readings with known outliers
- Verify automatic status changes
- Check site_conditions view accuracy

---

## Timeline Considerations

This migration can be executed incrementally:

1. **Database schema**: Can be added immediately (no breaking changes)
2. **API changes**: Can be deployed with backward compatibility
3. **Collector changes**: Can be updated per-Pi at your pace
4. **Frontend**: Purely additive, ship when ready

The system remains fully functional throughout migration.

---

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `supabase/schema.sql` | 1 | Add new tables, views, functions |
| `supabase/migrations/001_multi_instrument.sql` | 1 | Migration script (new) |
| `supabase/migrations/002_backfill_data.sql` | 2 | Historical data backfill (new) |
| `src/app/api/ingest/data/route.ts` | 3 | Accept instrument_code, auto-register, dual-write |
| `src/app/api/current/route.ts` | 3 | Query site_conditions view, include failed instruments |
| `src/app/api/instruments/route.ts` | 3 | New: list/create instruments |
| `src/app/api/instruments/[code]/route.ts` | 3 | New: get/update specific instrument |
| `src/types/weather.ts` | 3 | Add Instrument, InstrumentReading, FailedInstrument types |
| `src/lib/supabase.ts` | 3 | Add instrument query helpers |
| `src/lib/instruments.ts` | 3 | New: auto-registration, type inference helpers |
| `raspberry-pi/collector.py` | 4 | Multi-instrument data store |
| `raspberry-pi/.env` | 4 | Add instrument codes |
| `src/app/page.tsx` | 5 | Clickable cards, modal state, failure banner |
| `src/app/page.module.css` | 5 | Clickable card styles, modal styles |
| `src/components/SQMGraph.tsx` | 5 | Multi-trace support, toggle button |
| `src/components/WeatherStat.tsx` | 5 | Add onClick, hasMultipleSources props |
| `src/components/WeatherStat.module.css` | 5 | Clickable styles, source indicator |
| `src/components/InstrumentAlert.tsx` | 5 | New: failure banner component |
| `src/components/InstrumentAlert.module.css` | 5 | New: banner styles |
| `src/components/InstrumentDetailModal.tsx` | 5 | New: per-instrument breakdown modal |
| `src/components/InstrumentDetailModal.module.css` | 5 | New: modal styles |
| `src/components/ConditionIndicator.tsx` | 5 | Add onClick prop for consistency |

---

---

## Complete Migration SQL

For convenience, here is the complete SQL migration script to run in Supabase SQL Editor:

```sql
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

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES (run these to confirm migration success)
-- ─────────────────────────────────────────────────────────────────────────────

-- Check instruments created
-- SELECT * FROM instruments;

-- Check data backfill counts
-- SELECT
--     (SELECT COUNT(*) FROM weather_readings) as old_count,
--     (SELECT COUNT(*) FROM instrument_readings) as new_count;

-- Check site_conditions view works
-- SELECT * FROM site_conditions;

-- Check failed instruments query
-- SELECT code, name, status, last_reading_at, consecutive_outliers
-- FROM instruments WHERE status != 'active';
```

---

## Design Decisions (Resolved)

1. **Instrument auto-registration**: ✅ Auto-register unknown `instrument_code` values with sensible defaults
2. **Historical data migration**: ✅ Migrate and backfill existing `weather_readings` into `instrument_readings`
3. **Dashboard default**: ✅ Show site averages only, with click-to-expand for individual instrument details
4. **Outlier notification**: ✅ Show failed instruments on dashboard (banner/indicator); additional notification methods (email, webhook) can be added later
