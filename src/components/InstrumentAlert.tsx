"use client";

import { useState } from "react";
import { FailedInstrument } from "@/types/weather";
import { formatRelativeTime, getStatusColor } from "@/lib/instruments";
import styles from "./InstrumentAlert.module.css";

interface InstrumentAlertProps {
  failedInstruments: FailedInstrument[];
  onInstrumentClick?: (code: string) => void;
}

export default function InstrumentAlert({
  failedInstruments,
  onInstrumentClick,
}: InstrumentAlertProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || failedInstruments.length === 0) {
    return null;
  }

  const offlineCount = failedInstruments.filter(
    (i) => i.status === "offline"
  ).length;
  const degradedCount = failedInstruments.filter(
    (i) => i.status === "degraded"
  ).length;

  const getAlertLevel = () => {
    if (offlineCount > 0) return "error";
    if (degradedCount > 0) return "warning";
    return "info";
  };

  return (
    <div className={`${styles.alert} ${styles[getAlertLevel()]}`}>
      <div className={styles.content}>
        <span className={styles.icon}>
          {offlineCount > 0 ? "!" : "?"}
        </span>
        <div className={styles.message}>
          <strong>
            {failedInstruments.length} instrument
            {failedInstruments.length !== 1 ? "s" : ""} need
            {failedInstruments.length === 1 ? "s" : ""} attention
          </strong>
          <div className={styles.details}>
            {failedInstruments.map((inst, index) => (
              <span key={inst.code}>
                {index > 0 && ", "}
                <button
                  className={styles.instrumentLink}
                  onClick={() => onInstrumentClick?.(inst.code)}
                  style={{ color: getStatusColor(inst.status) }}
                >
                  {inst.name}
                </button>
                <span className={styles.status}>
                  ({inst.status}
                  {inst.lastReadingAt && ` - ${formatRelativeTime(inst.lastReadingAt)}`})
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss alert"
      >
        x
      </button>
    </div>
  );
}
