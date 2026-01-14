"use client";

import { siteConfig, getDisplayLocation } from "@/lib/config";
import { TelemetryHealth } from "@/types/weather";
import { formatRelativeTime } from "@/lib/instruments";
import styles from "./ObservatoryInfo.module.css";

interface ObservatoryInfoProps {
  telemetryHealth?: TelemetryHealth | null;
}

export function ObservatoryInfo({ telemetryHealth }: ObservatoryInfoProps) {
  const location = getDisplayLocation();
  const hasMpcCodes = siteConfig.mpcCodes && siteConfig.mpcCodes.length > 0;

  // Compute telemetry status display
  const getTelemetryStatusIcon = () => {
    if (!telemetryHealth) return "○";
    switch (telemetryHealth.status) {
      case "operational":
        return "●";
      case "degraded":
        return "◐";
      case "offline":
        return "○";
      default:
        return "?";
    }
  };

  const getTelemetryStatusColor = () => {
    if (!telemetryHealth) return "var(--color-muted, #6b7280)";
    switch (telemetryHealth.status) {
      case "operational":
        return "var(--color-success, #22c55e)";
      case "degraded":
        return "var(--color-warning, #f59e0b)";
      case "offline":
        return "var(--color-error, #ef4444)";
      default:
        return "var(--color-muted, #6b7280)";
    }
  };

  const getTelemetryStatusText = () => {
    if (!telemetryHealth) return "Unknown";
    if (telemetryHealth.status === "operational") {
      return "All systems operational";
    }
    const failed = [
      ...telemetryHealth.offlineInstruments,
      ...telemetryHealth.degradedInstruments,
    ];
    if (failed.length === 0) return "All systems operational";
    return `${failed.length} instrument${failed.length === 1 ? "" : "s"} degraded`;
  };

  return (
    <div className={styles.observatoryInfo}>
      {/* Telemetry Status */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>📡</span>
          <span className={styles.sectionTitle}>Telemetry</span>
        </div>
        <div className={styles.telemetryStatus}>
          <div className={styles.statusRow}>
            <span
              className={styles.statusIcon}
              style={{ color: getTelemetryStatusColor() }}
            >
              {getTelemetryStatusIcon()}
            </span>
            <span className={styles.statusText}>{getTelemetryStatusText()}</span>
          </div>
          {telemetryHealth && telemetryHealth.expectedCount > 0 && (
            <div className={styles.statusDetail}>
              {telemetryHealth.activeCount}/{telemetryHealth.expectedCount} instruments online
            </div>
          )}
          {/* List degraded/offline instruments */}
          {telemetryHealth && (
            <>
              {telemetryHealth.offlineInstruments.map((inst) => (
                <div key={inst.code} className={styles.failedInstrument}>
                  <span className={styles.failedIcon} style={{ color: "var(--color-error, #ef4444)" }}>○</span>
                  <span className={styles.failedName}>{inst.name}</span>
                  <span className={styles.failedTime}>{formatRelativeTime(inst.lastReadingAt)}</span>
                </div>
              ))}
              {telemetryHealth.degradedInstruments.map((inst) => (
                <div key={inst.code} className={styles.failedInstrument}>
                  <span className={styles.failedIcon} style={{ color: "var(--color-warning, #f59e0b)" }}>◐</span>
                  <span className={styles.failedName}>{inst.name}</span>
                  <span className={styles.failedTime}>{formatRelativeTime(inst.lastReadingAt)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Location */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>📍</span>
          <span className={styles.sectionTitle}>Location</span>
        </div>
        <div className={styles.locationGrid}>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Latitude</span>
            <span className={styles.locationValue}>{location.latitude}</span>
          </div>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Longitude</span>
            <span className={styles.locationValue}>{location.longitude}</span>
          </div>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Altitude</span>
            <span className={styles.locationValue}>{location.altitude}</span>
          </div>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Timezone</span>
            <span className={styles.locationValue}>
              UTC{siteConfig.timezone >= 0 ? "+" : ""}
              {siteConfig.timezone}
            </span>
          </div>
        </div>
      </div>

      {/* MPC Codes */}
      {hasMpcCodes && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>🔭</span>
            <span className={styles.sectionTitle}>MPC Observatory</span>
          </div>
          <div className={styles.mpcCodes}>
            {siteConfig.mpcCodes.map((code) => (
              <a
                key={code}
                href={`https://minorplanetcenter.net/db_search/show_object?object_id=${code}&commit=Show`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.mpcCode}
                title="View on Minor Planet Center"
              >
                <span className={styles.mpcLabel}>MPC</span>
                <span className={styles.mpcValue}>{code}</span>
              </a>
            ))}
          </div>
          <div className={styles.mpcNote}>
            Registered with the{" "}
            <a
              href="https://minorplanetcenter.net/iau/lists/ObsCodesF.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Minor Planet Center
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
