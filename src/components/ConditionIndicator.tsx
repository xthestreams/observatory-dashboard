import styles from "./ConditionIndicator.module.css";

interface ConditionIndicatorProps {
  label: string;
  condition: string;
  icon: string;
  color: string;
  detail?: string;
}

export function ConditionIndicator({
  label,
  condition,
  icon,
  color,
  detail,
}: ConditionIndicatorProps) {
  return (
    <div className={styles.indicator}>
      <div className={styles.icon}>{icon}</div>
      <div className={styles.label}>{label}</div>
      <div className={styles.status} style={{ color }}>
        {condition}
      </div>
      {detail && <div className={styles.detail}>{detail}</div>}
    </div>
  );
}
