import styles from "./ConditionIndicator.module.css";

interface ConditionIndicatorProps {
  label: string;
  condition: string;
  icon: string;
  color: string;
  detail?: string;
  onClick?: () => void;
}

export function ConditionIndicator({
  label,
  condition,
  icon,
  color,
  detail,
  onClick,
}: ConditionIndicatorProps) {
  const isClickable = !!onClick;

  return (
    <div
      className={`${styles.indicator} ${isClickable ? styles.clickable : ""}`}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className={styles.icon}>{icon}</div>
      <div className={styles.label}>{label}</div>
      <div className={styles.status} style={{ color }}>
        {condition}
      </div>
      {detail && <div className={styles.detail}>{detail}</div>}
    </div>
  );
}
