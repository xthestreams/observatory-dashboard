import styles from "./WeatherStat.module.css";

interface WeatherStatProps {
  label: string;
  value: number | null | undefined;
  unit: string;
  precision?: number;
  suffix?: string;
  onClick?: () => void;
  instrumentCount?: number;
}

export function WeatherStat({
  label,
  value,
  unit,
  precision = 1,
  suffix = "",
  onClick,
  instrumentCount,
}: WeatherStatProps) {
  const isClickable = !!onClick;
  const showBadge = instrumentCount && instrumentCount > 1;

  return (
    <div
      className={`${styles.stat} ${isClickable ? styles.clickable : ""}`}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {showBadge && (
          <span className={styles.badge} title={`${instrumentCount} instruments`}>
            {instrumentCount}
          </span>
        )}
      </div>
      <div className={styles.value}>
        {value !== null && value !== undefined ? value.toFixed(precision) : "--"}
        <span className={styles.unit}>{unit}</span>
        {suffix}
      </div>
      {isClickable && <div className={styles.clickHint}>Click for details</div>}
    </div>
  );
}
