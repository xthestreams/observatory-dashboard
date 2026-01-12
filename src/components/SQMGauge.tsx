import styles from "./SQMGauge.module.css";

interface SQMGaugeProps {
  value: number | null;
}

export function SQMGauge({ value }: SQMGaugeProps) {
  // SQM scale: typically 16 (urban) to 22+ (excellent dark sky)
  const min = 16;
  const max = 22;
  const percent = value
    ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
    : 0;

  const getQualityLabel = (sqm: number | null): string => {
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
