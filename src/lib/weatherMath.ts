/**
 * Shared math helpers for aggregating multi-sensor weather readings.
 */

// A humidity reading more than this many percentage points away from the
// median of the other sensors is treated as an outlier and excluded from
// the site average.
export const HUMIDITY_OUTLIER_DEVIATION = 20;

/**
 * Remove values that deviate from the median by more than maxDeviation.
 * Falls back to the original values if filtering would remove everything
 * (e.g. all sensors disagree), so we never end up with no reading at all.
 */
export function excludeOutliers(values: number[], maxDeviation: number): number[] {
  if (values.length < 3) return values;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;

  const filtered = values.filter(v => Math.abs(v - median) <= maxDeviation);
  return filtered.length > 0 ? filtered : values;
}

/**
 * Dew point in °C using the Magnus-Tetens approximation.
 */
export function calculateDewPoint(tempC: number, relHumidityPct: number): number {
  const a = 17.62;
  const b = 243.12;
  const gamma = (a * tempC) / (b + tempC) + Math.log(relHumidityPct / 100);
  return (b * gamma) / (a - gamma);
}
