import styles from "./WeatherStat.module.css";

interface WeatherStatProps {
  label: string;
  value: number | null | undefined;
  unit: string;
  precision?: number;
  suffix?: string;
}

export function WeatherStat({
  label,
  value,
  unit,
  precision = 1,
  suffix = "",
}: WeatherStatProps) {
  return (
    <div className={styles.stat}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>
        {value !== null && value !== undefined ? value.toFixed(precision) : "--"}
        <span className={styles.unit}>{unit}</span>
        {suffix}
      </div>
    </div>
  );
}
