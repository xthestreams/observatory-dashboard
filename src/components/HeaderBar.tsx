"use client";

import { siteConfig, getDisplayLocation } from "@/lib/config";
import { TelemetryHealth, PowerStatus } from "@/types/weather";
import { formatRelativeTime } from "@/lib/instruments";
import styles from "./HeaderBar.module.css";

interface HeaderBarProps {
  telemetryHealth?: TelemetryHealth | null;
  lastUpdate?: Date | null;
}

export function HeaderBar({ telemetryHealth, lastUpdate }: HeaderBarProps) {
  const location = getDisplayLocation();
  const hasMpcCodes = siteConfig.mpcCodes && siteConfig.mpcCodes.length > 0;

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
    if (!telemetryHealth) return "#6b7280";
    switch (telemetryHealth.status) {
      case "operational":
        return "#22c55e";
      case "degraded":
        return "#f59e0b";
      case "offline":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  const getInstrumentSummary = () => {
    if (!telemetryHealth || telemetryHealth.expectedCount === 0) return null;
    return `${telemetryHealth.activeCount}/${telemetryHealth.expectedCount}`;
  };

  // Power status helpers
  const powerStatus = telemetryHealth?.collectorHeartbeat?.powerStatus;

  const getPowerStatusIcon = () => {
    if (!powerStatus || powerStatus.status === "unknown") return "○";
    switch (powerStatus.status) {
      case "good":
        return "●";
      case "degraded":
        return "◐";
      case "down":
        return "○";
      default:
        return "?";
    }
  };

  const getPowerStatusColor = () => {
    if (!powerStatus || powerStatus.status === "unknown") return "#6b7280";
    switch (powerStatus.status) {
      case "good":
        return "#22c55e";  // Green
      case "degraded":
        return "#f59e0b";  // Amber
      case "down":
        return "#ef4444";  // Red
      default:
        return "#6b7280";
    }
  };

  const getPowerStatusLabel = () => {
    if (!powerStatus || powerStatus.status === "unknown") return "Unknown";
    switch (powerStatus.status) {
      case "good":
        return "Good";
      case "degraded":
        return "Degraded";
      case "down":
        return "Down";
      default:
        return "Unknown";
    }
  };

  const getPowerDetail = () => {
    if (!powerStatus) return null;

    // Show battery percentage if on battery
    if (powerStatus.ups_status && (powerStatus.ups_status.includes("OB") || powerStatus.ups_status.includes("LB"))) {
      if (powerStatus.battery_charge !== null) {
        const runtime = powerStatus.battery_runtime
          ? ` (${Math.floor(powerStatus.battery_runtime / 60)}m)`
          : "";
        return `${powerStatus.battery_charge}%${runtime}`;
      }
    }

    // Show input voltage when on mains
    if (powerStatus.input_voltage !== null) {
      return `${Math.round(powerStatus.input_voltage)}V`;
    }

    return null;
  };

  return (
    <header className={styles.headerBar}>
      {/* Logo and Name */}
      <div className={styles.identity}>
        {siteConfig.logoUrl ? (
          <img
            src={siteConfig.logoUrl}
            alt={`${siteConfig.siteName} logo`}
            className={styles.logo}
          />
        ) : (
          <div className={styles.logoPlaceholder}>
            <span>🔭</span>
          </div>
        )}
        <div className={styles.nameBlock}>
          <h1 className={styles.siteName}>{siteConfig.siteName}</h1>
          <p className={styles.subtitle}>{siteConfig.siteSubtitle}</p>
        </div>
      </div>

      {/* Location */}
      <div className={styles.infoGroup}>
        <span className={styles.groupIcon}>📍</span>
        <div className={styles.groupContent}>
          <span className={styles.primaryValue}>{location.latitude}, {location.longitude}</span>
          <span className={styles.secondaryValue}>{location.altitude} • UTC{siteConfig.timezone >= 0 ? "+" : ""}{siteConfig.timezone}</span>
        </div>
      </div>

      {/* MPC Code */}
      {hasMpcCodes && (
        <div className={styles.infoGroup}>
          <span className={styles.groupIcon}>🔭</span>
          <div className={styles.groupContent}>
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
                  MPC {code}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Power Status */}
      <div className={styles.infoGroup}>
        <span className={styles.groupIcon}>⚡</span>
        <div className={styles.groupContent}>
          <div className={styles.telemetryRow}>
            <span
              className={styles.statusDot}
              style={{ color: getPowerStatusColor() }}
            >
              {getPowerStatusIcon()}
            </span>
            <span className={styles.primaryValue}>
              Power: {getPowerStatusLabel()}
            </span>
            {getPowerDetail() && (
              <span className={styles.instrumentCount}>{getPowerDetail()}</span>
            )}
          </div>
          {powerStatus?.status === "degraded" && (
            <div className={styles.secondaryValue}>
              On battery
            </div>
          )}
          {powerStatus?.status === "down" && (
            <div className={styles.failedList}>
              <span className={styles.failedItem} style={{ color: "#ef4444" }}>
                {powerStatus?.battery_charge !== null
                  ? `Low battery: ${powerStatus.battery_charge}%`
                  : "UPS offline"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Telemetry Status */}
      <div className={styles.infoGroup}>
        <span className={styles.groupIcon}>📡</span>
        <div className={styles.groupContent}>
          <div className={styles.telemetryRow}>
            <span
              className={styles.statusDot}
              style={{ color: getTelemetryStatusColor() }}
            >
              {getTelemetryStatusIcon()}
            </span>
            <span className={styles.primaryValue}>
              {telemetryHealth?.status === "operational" ? "Operational" : telemetryHealth?.status || "Unknown"}
            </span>
            {getInstrumentSummary() && (
              <span className={styles.instrumentCount}>{getInstrumentSummary()}</span>
            )}
          </div>
          {telemetryHealth && (telemetryHealth.offlineInstruments.length > 0 || telemetryHealth.degradedInstruments.length > 0) && (
            <div className={styles.failedList}>
              {telemetryHealth.offlineInstruments.map((inst) => (
                <span key={inst.code} className={styles.failedItem} style={{ color: "#ef4444" }}>
                  {inst.name}
                </span>
              ))}
              {telemetryHealth.degradedInstruments.map((inst) => (
                <span key={inst.code} className={styles.failedItem} style={{ color: "#f59e0b" }}>
                  {inst.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Last Update */}
      <div className={styles.updateTime}>
        <span className={styles.updateLabel}>Updated</span>
        <span className={styles.updateValue}>
          {lastUpdate ? lastUpdate.toLocaleTimeString() : "--:--:--"}
        </span>
      </div>
    </header>
  );
}
