import { siteConfig } from "@/lib/config";
import styles from "./SQMGauge.module.css";

interface SQMGaugeProps {
  value: number | null;
}

/**
 * Calculate sunrise and sunset times for a given date and location
 * Uses simplified solar position algorithm
 */
function getSunTimes(date: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } {
  // Day of year
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  // Solar declination (approximate)
  const declination = -23.45 * Math.cos((360 / 365) * (dayOfYear + 10) * (Math.PI / 180));

  // Hour angle at sunrise/sunset
  const latRad = lat * (Math.PI / 180);
  const decRad = declination * (Math.PI / 180);

  // Account for atmospheric refraction (-0.833 degrees)
  const zenith = 90.833 * (Math.PI / 180);

  const cosHourAngle = (Math.cos(zenith) - Math.sin(latRad) * Math.sin(decRad)) /
                       (Math.cos(latRad) * Math.cos(decRad));

  // Clamp for polar regions
  const clampedCos = Math.max(-1, Math.min(1, cosHourAngle));
  const hourAngle = Math.acos(clampedCos) * (180 / Math.PI);

  // Equation of time (approximate)
  const B = (360 / 365) * (dayOfYear - 81) * (Math.PI / 180);
  const EoT = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // Solar noon in UTC (minutes from midnight)
  const solarNoonUTC = 720 - (lon * 4) - EoT;

  // Sunrise and sunset in UTC minutes
  const sunriseUTC = solarNoonUTC - (hourAngle * 4);
  const sunsetUTC = solarNoonUTC + (hourAngle * 4);

  // Convert to Date objects
  const baseDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

  const sunrise = new Date(baseDate.getTime() + sunriseUTC * 60 * 1000);
  const sunset = new Date(baseDate.getTime() + sunsetUTC * 60 * 1000);

  return { sunrise, sunset };
}

/**
 * Check if it's currently daylight at the configured location
 */
function isDaylight(): boolean {
  const now = new Date();
  const { sunrise, sunset } = getSunTimes(now, siteConfig.latitude, siteConfig.longitude);
  return now >= sunrise && now <= sunset;
}

export function SQMGauge({ value }: SQMGaugeProps) {
  // SQM scale: typically 16 (urban) to 22+ (excellent dark sky)
  const min = 16;
  const max = 22;
  const percent = value
    ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
    : 0;

  const getQualityLabel = (sqm: number | null): string => {
    // Check for daylight conditions when SQM reads very low
    if (sqm !== null && sqm < 10 && isDaylight()) {
      return "Daylight";
    }
    if (!sqm) return "Unknown";
    if (sqm >= 21.5) return "Excellent";
    if (sqm >= 21.0) return "Very Good";
    if (sqm >= 20.5) return "Good";
    if (sqm >= 20.0) return "Moderate";
    if (sqm >= 19.0) return "Poor";
    return "Very Poor";
  };

  return (
    <div className={styles.gauge}>
      <div className={styles.bar}>
        <div className={styles.marker} style={{ left: `${percent}%` }} />
      </div>
      <div className={styles.labels}>
        <span>Urban</span>
        <span>Suburban</span>
        <span>Rural</span>
        <span>Dark Sky</span>
      </div>
      <div className={styles.quality}>{getQualityLabel(value)}</div>
    </div>
  );
}
