-- ============================================================================
-- MIGRATION: Add expected instruments tracking
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================================

-- Add 'expected' column to track which instruments the Pi collector expects
-- Instruments with expected=true are configured on the Pi
-- Instruments with expected=false may be legacy/removed
ALTER TABLE instruments
ADD COLUMN IF NOT EXISTS expected BOOLEAN DEFAULT false;

-- Add 'collector_id' to track which collector registered this instrument
-- Useful when multiple Pis report to the same dashboard
ALTER TABLE instruments
ADD COLUMN IF NOT EXISTS collector_id VARCHAR(64);

-- Update existing instruments to be expected (since they're already reporting)
UPDATE instruments
SET expected = true
WHERE last_reading_at IS NOT NULL
  AND last_reading_at > NOW() - INTERVAL '1 hour';

-- Create index for querying expected instruments
CREATE INDEX IF NOT EXISTS idx_instruments_expected
ON instruments(expected) WHERE expected = true;

-- Create index for querying by collector
CREATE INDEX IF NOT EXISTS idx_instruments_collector
ON instruments(collector_id) WHERE collector_id IS NOT NULL;
