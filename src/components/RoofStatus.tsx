"use client";

import { RoofStatus } from "@/types/client";
import styles from "./RoofStatus.module.css";

interface RoofStatusPanelProps {
  status: RoofStatus;
  onCommand?: (command: "open" | "close" | "stop") => Promise<void>;
}

export function RoofStatusPanel({ status, onCommand }: RoofStatusPanelProps) {
  const getStateColor = (): string => {
    switch (status.state) {
      case "open":
        return "#4caf50"; // green
      case "closed":
        return "#2196f3"; // blue
      case "opening":
      case "closing":
        return "#ff9800"; // orange
      case "unknown":
      default:
        return "#999"; // gray
    }
  };

  const getStateIcon = (): string => {
    switch (status.state) {
      case "open":
        return "⬆️";
      case "closed":
        return "⬇️";
      case "opening":
        return "📈";
      case "closing":
        return "📉";
      default:
        return "❓";
    }
  };

  const getStateLabel = (): string => {
    switch (status.state) {
      case "open":
        return "OPEN";
      case "closed":
        return "CLOSED";
      case "opening":
        return "OPENING";
      case "closing":
        return "CLOSING";
      default:
        return "UNKNOWN";
    }
  };

  const isMoving = status.state === "opening" || status.state === "closing";

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Roof Status</h3>
      </div>

      <div
        className={styles.statusDisplay}
        style={{ borderColor: getStateColor() }}
      >
        <div className={styles.iconLarge}>{getStateIcon()}</div>
        <div className={styles.statusInfo}>
          <div className={styles.stateLabel} style={{ color: getStateColor() }}>
            {getStateLabel()}
          </div>
          {status.position !== null && (
            <div className={styles.positionBar}>
              <div
                className={styles.positionFill}
                style={{
                  width: `${status.position}%`,
                  backgroundColor: getStateColor(),
                }}
              />
              <div className={styles.positionLabel}>
                {status.position}%
              </div>
            </div>
          )}
        </div>
      </div>

      {status.error_message && (
        <div className={styles.error}>
          <span className={styles.errorIcon}>⚠️</span>
          {status.error_message}
        </div>
      )}

      {!status.is_operational && (
        <div className={styles.warning}>
          <span>🚫</span>
          Roof is not operational
        </div>
      )}

      <div className={styles.lastUpdated}>
        Last updated: {new Date(status.updated_at).toLocaleTimeString()}
      </div>

      {onCommand && !isMoving && status.is_operational && (
        <div className={styles.controls}>
          {status.state !== "open" && (
            <button
              className={`${styles.button} ${styles.buttonOpen}`}
              onClick={() => onCommand("open")}
            >
              ⬆️ Open Roof
            </button>
          )}
          {status.state !== "closed" && (
            <button
              className={`${styles.button} ${styles.buttonClose}`}
              onClick={() => onCommand("close")}
            >
              ⬇️ Close Roof
            </button>
          )}
        </div>
      )}

      {isMoving && (
        <div className={styles.moving}>
          <div className={styles.spinner} />
          Roof is moving...
        </div>
      )}
    </div>
  );
}
