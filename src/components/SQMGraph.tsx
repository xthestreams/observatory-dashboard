"use client";

import { useMemo, useState } from "react";
import { HistoricalReading } from "@/types/weather";
import { siteConfig } from "@/lib/config";
import styles from "./SQMGraph.module.css";

interface SQMGraphProps {
  history: HistoricalReading[];
  historyByInstrument?: Record<string, HistoricalReading[]>;
}

// Color palette for different instruments
const INSTRUMENT_COLORS = [
  "#60a5fa", // Blue (primary)
  "#34d399", // Green
  "#f472b6", // Pink
  "#a78bfa", // Purple
  "#fbbf24", // Yellow (reserved for moon, but can be used)
  "#fb923c", // Orange
];

// Calculate moon altitude for a given time using simplified algorithm
function calculateMoonAltitude(timestamp: string, lat: number, lon: number): number {
  const date = new Date(timestamp);

  // Julian date calculation
  const JD = date.getTime() / 86400000 + 2440587.5;

  // Days since J2000.0
  const d = JD - 2451545.0;

  // Moon's orbital elements (simplified)
  const N = (125.1228 - 0.0529538083 * d) % 360;
  const i = 5.1454;
  const w = (318.0634 + 0.1643573223 * d) % 360;
  const a = 60.2666;
  const e = 0.054900;
  const M = (115.3654 + 13.0649929509 * d) % 360;

  // Eccentric anomaly (simplified)
  const E = M + (180 / Math.PI) * e * Math.sin(M * Math.PI / 180);

  // Moon's position in orbital plane
  const xv = a * (Math.cos(E * Math.PI / 180) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * Math.PI / 180);

  // True anomaly and distance
  const v = Math.atan2(yv, xv) * 180 / Math.PI;
  const r = Math.sqrt(xv * xv + yv * yv);

  // Ecliptic coordinates
  const xh = r * (Math.cos(N * Math.PI / 180) * Math.cos((v + w) * Math.PI / 180) -
              Math.sin(N * Math.PI / 180) * Math.sin((v + w) * Math.PI / 180) * Math.cos(i * Math.PI / 180));
  const yh = r * (Math.sin(N * Math.PI / 180) * Math.cos((v + w) * Math.PI / 180) +
              Math.cos(N * Math.PI / 180) * Math.sin((v + w) * Math.PI / 180) * Math.cos(i * Math.PI / 180));
  const zh = r * Math.sin((v + w) * Math.PI / 180) * Math.sin(i * Math.PI / 180);

  // Ecliptic longitude and latitude
  const lonEcl = Math.atan2(yh, xh) * 180 / Math.PI;
  const latEcl = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * 180 / Math.PI;

  // Obliquity of ecliptic
  const oblecl = 23.4393 - 3.563E-7 * d;

  // Equatorial coordinates
  const xeq = r * Math.cos(lonEcl * Math.PI / 180) * Math.cos(latEcl * Math.PI / 180);
  const yeq = r * (Math.cos(oblecl * Math.PI / 180) * Math.cos(latEcl * Math.PI / 180) * Math.sin(lonEcl * Math.PI / 180) -
              Math.sin(oblecl * Math.PI / 180) * Math.sin(latEcl * Math.PI / 180));
  const zeq = r * (Math.sin(oblecl * Math.PI / 180) * Math.cos(latEcl * Math.PI / 180) * Math.sin(lonEcl * Math.PI / 180) +
              Math.cos(oblecl * Math.PI / 180) * Math.sin(latEcl * Math.PI / 180));

  // Right ascension and declination
  const RA = Math.atan2(yeq, xeq) * 180 / Math.PI;
  const Dec = Math.atan2(zeq, Math.sqrt(xeq * xeq + yeq * yeq)) * 180 / Math.PI;

  // Sidereal time
  const UT = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const GMST = (280.46061837 + 360.98564736629 * d + UT * 15) % 360;
  const LST = (GMST + lon) % 360;
  const HA = LST - RA;

  // Convert to altitude
  const sinAlt = Math.sin(lat * Math.PI / 180) * Math.sin(Dec * Math.PI / 180) +
                 Math.cos(lat * Math.PI / 180) * Math.cos(Dec * Math.PI / 180) * Math.cos(HA * Math.PI / 180);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;

  return altitude;
}

export function SQMGraph({ history, historyByInstrument }: SQMGraphProps) {
  const [showIndividual, setShowIndividual] = useState(false);

  // Get instrument codes and assign colors
  const instrumentCodes = useMemo(() => {
    if (!historyByInstrument) return [];
    return Object.keys(historyByInstrument).sort();
  }, [historyByInstrument]);

  const hasMultipleInstruments = instrumentCodes.length > 1;

  // Calculate moon altitude for each data point
  const historyWithMoon = useMemo(() => {
    return history.map(h => ({
      ...h,
      moon_altitude: calculateMoonAltitude(
        h.timestamp,
        siteConfig.latitude,
        siteConfig.longitude
      )
    }));
  }, [history]);

  // Process per-instrument history
  const instrumentHistories = useMemo(() => {
    if (!historyByInstrument) return {};

    const result: Record<string, Array<HistoricalReading & { moon_altitude: number }>> = {};

    for (const [code, readings] of Object.entries(historyByInstrument)) {
      result[code] = readings.map(h => ({
        ...h,
        moon_altitude: calculateMoonAltitude(
          h.timestamp,
          siteConfig.latitude,
          siteConfig.longitude
        )
      }));
    }

    return result;
  }, [historyByInstrument]);

  if (!historyWithMoon.length) {
    return (
      <div className={styles.empty}>
        <p>No historical data available</p>
      </div>
    );
  }

  // SVG dimensions
  const width = 400;
  const height = 140;
  const padding = { top: 15, right: 40, bottom: 25, left: 35 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // SQM scale: 0 (bright) to 22 (dark) - inverted so dark is at top
  const sqmMin = 0;
  const sqmMax = 22;

  // Moon altitude scale: -90 to 90 degrees
  const moonMin = -90;
  const moonMax = 90;

  // Time range for X axis (based on timestamps)
  const allTimestamps = historyWithMoon.map(h => new Date(h.timestamp).getTime());
  const minTime = Math.min(...allTimestamps);
  const maxTime = Math.max(...allTimestamps);
  const timeRange = maxTime - minTime || 1;

  // X scale based on timestamp
  const xScale = (timestamp: string) => {
    const t = new Date(timestamp).getTime();
    return padding.left + ((t - minTime) / timeRange) * chartWidth;
  };

  // Y scale for SQM (inverted - higher values at top)
  const sqmYScale = (v: number) =>
    padding.top + ((sqmMax - v) / (sqmMax - sqmMin)) * chartHeight;

  // Y scale for moon altitude
  const moonYScale = (v: number) =>
    padding.top + ((moonMax - v) / (moonMax - moonMin)) * chartHeight;

  // Generate path from data points
  const generatePath = (data: Array<{ timestamp: string; sky_quality: number }>) => {
    return data
      .map((h, i) => `${i === 0 ? "M" : "L"} ${xScale(h.timestamp)} ${sqmYScale(h.sky_quality)}`)
      .join(" ");
  };

  // Generate moon path
  const moonPath = historyWithMoon
    .map((h, i) => `${i === 0 ? "M" : "L"} ${xScale(h.timestamp)} ${moonYScale(h.moon_altitude ?? 0)}`)
    .join(" ");

  // Time labels - show 6 evenly spaced
  const timeLabels = [0, 1, 2, 3, 4, 5].map(i =>
    Math.floor(i * (historyWithMoon.length - 1) / 5)
  );

  return (
    <div className={styles.graph}>
      <div className={styles.legend}>
        {hasMultipleInstruments && showIndividual ? (
          // Show individual instrument legend
          instrumentCodes.map((code, idx) => (
            <span key={code} className={styles.legendItem}>
              <span
                className={styles.sqmDot}
                style={{ background: INSTRUMENT_COLORS[idx % INSTRUMENT_COLORS.length] }}
              />
              {code}
            </span>
          ))
        ) : (
          // Show combined SQM legend
          <span className={styles.legendItem}>
            <span className={styles.sqmDot}></span> SQM{hasMultipleInstruments ? " (avg)" : ""}
          </span>
        )}
        <span className={styles.legendItem}>
          <span className={styles.moonDot}></span> Moon
        </span>
        {hasMultipleInstruments && (
          <button
            className={styles.toggleButton}
            onClick={() => setShowIndividual(!showIndividual)}
            title={showIndividual ? "Show average" : "Show individual instruments"}
          >
            {showIndividual ? "Avg" : "All"}
          </button>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Horizon line for moon (0 degrees) */}
        <line
          x1={padding.left}
          y1={moonYScale(0)}
          x2={width - padding.right}
          y2={moonYScale(0)}
          stroke="rgba(255, 200, 100, 0.3)"
          strokeWidth="1"
          strokeDasharray="4,4"
        />

        {/* SQM grid lines */}
        {[0, 11, 22].map((v) => (
          <line
            key={`sqm-grid-${v}`}
            x1={padding.left}
            y1={sqmYScale(v)}
            x2={width - padding.right}
            y2={sqmYScale(v)}
            stroke="rgba(96, 165, 250, 0.1)"
            strokeDasharray="2,2"
          />
        ))}

        {/* SQM Y-axis labels (left) */}
        {[0, 11, 22].map((v) => (
          <text
            key={`sqm-label-${v}`}
            x={padding.left - 5}
            y={sqmYScale(v) + 3}
            textAnchor="end"
            fill="#60a5fa"
            fontSize="9"
          >
            {v}
          </text>
        ))}

        {/* Moon Y-axis labels (right) */}
        {[-90, 0, 90].map((v) => (
          <text
            key={`moon-label-${v}`}
            x={width - padding.right + 5}
            y={moonYScale(v) + 3}
            textAnchor="start"
            fill="#fbbf24"
            fontSize="9"
          >
            {v}°
          </text>
        ))}

        {/* Moon altitude line */}
        <path
          d={moonPath}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.7"
        />

        {/* SQM data line(s) */}
        {hasMultipleInstruments && showIndividual ? (
          // Show individual instrument traces
          instrumentCodes.map((code, idx) => {
            const data = instrumentHistories[code];
            if (!data || data.length === 0) return null;
            return (
              <path
                key={code}
                d={generatePath(data)}
                fill="none"
                stroke={INSTRUMENT_COLORS[idx % INSTRUMENT_COLORS.length]}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.8"
              />
            );
          })
        ) : (
          // Show averaged SQM line
          <path
            d={generatePath(historyWithMoon)}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* X-axis time labels */}
        {timeLabels.map((i) => (
          <text
            key={`time-${i}`}
            x={xScale(historyWithMoon[i]?.timestamp)}
            y={height - 5}
            textAnchor="middle"
            fill="#666"
            fontSize="8"
          >
            {historyWithMoon[i]?.time}
          </text>
        ))}
      </svg>
    </div>
  );
}
