"use client";

import { useEffect, useCallback } from "react";
import {
  InstrumentReading,
  MetricName,
  METRIC_DISPLAY,
} from "@/types/weather";
import {
  formatRelativeTime,
  getStatusColor,
  getStatusIcon,
} from "@/lib/instruments";
import styles from "./InstrumentDetailModal.module.css";

interface InstrumentDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  metric: MetricName | null;
  instruments: InstrumentReading[];
  siteAverage: number | string | null;
}

export default function InstrumentDetailModal({
  isOpen,
  onClose,
  metric,
  instruments,
  siteAverage,
}: InstrumentDetailModalProps) {
  // Close on escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !metric) {
    return null;
  }

  const metricInfo = METRIC_DISPLAY[metric];
  const isConditionMetric = metric.includes("condition");

  const formatValue = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined) return "N/A";
    if (typeof value === "string") return value;
    return `${value.toFixed(metricInfo.decimals)}${metricInfo.unit}`;
  };

  // Sort instruments: active first, then by value
  const sortedInstruments = [...instruments].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (b.status === "active" && a.status !== "active") return 1;
    if (a.isOutlier && !b.isOutlier) return 1;
    if (!a.isOutlier && b.isOutlier) return -1;
    return 0;
  });

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{metricInfo.label}</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className={styles.content}>
          {/* Site Average */}
          <div className={styles.siteAverage}>
            <span className={styles.averageLabel}>Site Average</span>
            <span className={styles.averageValue}>
              {formatValue(siteAverage)}
            </span>
          </div>

          <div className={styles.divider} />

          {/* Instrument List */}
          <div className={styles.instrumentList}>
            {sortedInstruments.length === 0 ? (
              <div className={styles.empty}>
                No instruments measure this metric
              </div>
            ) : (
              sortedInstruments.map((inst) => {
                const value = inst[metric as keyof InstrumentReading];
                const isExcluded = inst.isOutlier || inst.status !== "active";

                return (
                  <div
                    key={inst.instrumentCode}
                    className={`${styles.instrumentRow} ${
                      isExcluded ? styles.excluded : ""
                    }`}
                  >
                    <div className={styles.instrumentInfo}>
                      <span
                        className={styles.statusIcon}
                        style={{ color: getStatusColor(inst.status) }}
                      >
                        {getStatusIcon(inst.status)}
                      </span>
                      <div className={styles.instrumentDetails}>
                        <span className={styles.instrumentName}>
                          {inst.instrumentName}
                        </span>
                        <span className={styles.instrumentMeta}>
                          {inst.instrumentType} &middot;{" "}
                          {formatRelativeTime(inst.lastReadingAt)}
                        </span>
                      </div>
                    </div>

                    <div className={styles.valueSection}>
                      <span
                        className={`${styles.value} ${
                          isExcluded ? styles.excludedValue : ""
                        }`}
                      >
                        {isConditionMetric
                          ? String(value || "Unknown")
                          : formatValue(value as number | null)}
                      </span>
                      {isExcluded && (
                        <span className={styles.excludedBadge}>
                          {inst.isOutlier ? "outlier" : inst.status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Legend */}
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <span
                className={styles.statusIcon}
                style={{ color: getStatusColor("active") }}
              >
                {getStatusIcon("active")}
              </span>
              <span>Active</span>
            </div>
            <div className={styles.legendItem}>
              <span
                className={styles.statusIcon}
                style={{ color: getStatusColor("degraded") }}
              >
                {getStatusIcon("degraded")}
              </span>
              <span>Degraded</span>
            </div>
            <div className={styles.legendItem}>
              <span
                className={styles.statusIcon}
                style={{ color: getStatusColor("offline") }}
              >
                {getStatusIcon("offline")}
              </span>
              <span>Offline</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
