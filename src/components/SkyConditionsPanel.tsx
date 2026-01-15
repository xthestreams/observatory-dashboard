"use client";

import { WeatherData, WeatherHistory, MetricName } from "@/types/weather";
import {
  getConditionColor,
  getHumidityCondition,
  getTempCondition,
} from "@/lib/weatherHelpers";
import { Sparkline } from "./Sparkline";
import styles from "./SkyConditionsPanel.module.css";

interface SkyConditionsPanelProps {
  data: WeatherData | null;
  weatherHistory?: WeatherHistory[];
  onMetricClick?: (metric: MetricName) => void;
  getInstrumentCount?: (metric: string) => number;
}

/**
 * Full-width Sky Conditions panel with measurements and 24h sparklines
 * Note: Cloud, wind, rain, daylight conditions moved to AlertConditions component
 */
export function SkyConditionsPanel({
  data,
  weatherHistory = [],
  onMetricClick,
  getInstrumentCount,
}: SkyConditionsPanelProps) {
  // Extract sparkline data from history
  const getSparklineData = (key: keyof WeatherHistory): number[] => {
    return weatherHistory
      .map(h => h[key])
      .filter((v): v is number => v !== null && v !== undefined);
  };

  const tempData = getSparklineData("temperature");
  const humidityData = getSparklineData("humidity");
  const dewpointData = getSparklineData("dewpoint");
  const windData = getSparklineData("wind_speed");
  const skyTempData = getSparklineData("sky_temp");
  const ambientTempData = getSparklineData("ambient_temp");
  const pressureData = getSparklineData("pressure");

  const handleClick = (metric: MetricName) => {
    onMetricClick?.(metric);
  };

  const instrumentCount = (metric: string) => getInstrumentCount?.(metric) ?? 0;

  // Helper to safely format numeric values
  const formatValue = (value: number | null | undefined, decimals: number, unit: string): string => {
    if (value == null) return "--";
    return `${value.toFixed(decimals)}${unit}`;
  };

  return (
    <div className={styles.container}>
      {/* Measurements with sparklines */}
      <div className={styles.measurementsRow}>
        {/* Temperature */}
        <div
          className={styles.measurementCard}
          onClick={() => handleClick("temperature")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.measurementHeader}>
            <span className={styles.measurementIcon}>🌡️</span>
            <span className={styles.measurementLabel}>Temperature</span>
            {instrumentCount("temperature") > 1 && (
              <span className={styles.badge}>{instrumentCount("temperature")}</span>
            )}
          </div>
          <div className={styles.measurementValue}>
            {formatValue(data?.temperature, 1, "°C")}
          </div>
          <div className={styles.measurementSparkline}>
            <Sparkline data={tempData} width={100} height={28} color="#f59e0b" showMinMax />
          </div>
          <div className={styles.measurementCondition} style={{ color: getConditionColor(getTempCondition(data?.temperature), "temp") }}>
            {getTempCondition(data?.temperature)}
          </div>
        </div>

        {/* Humidity */}
        <div
          className={styles.measurementCard}
          onClick={() => handleClick("humidity")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.measurementHeader}>
            <span className={styles.measurementIcon}>💧</span>
            <span className={styles.measurementLabel}>Humidity</span>
            {instrumentCount("humidity") > 1 && (
              <span className={styles.badge}>{instrumentCount("humidity")}</span>
            )}
          </div>
          <div className={styles.measurementValue}>
            {formatValue(data?.humidity, 0, "%")}
          </div>
          <div className={styles.measurementSparkline}>
            <Sparkline data={humidityData} width={100} height={28} color="#3b82f6" showMinMax />
          </div>
          <div className={styles.measurementCondition} style={{ color: getConditionColor(getHumidityCondition(data?.humidity), "humidity") }}>
            {getHumidityCondition(data?.humidity)}
          </div>
        </div>

        {/* Dewpoint */}
        <div
          className={styles.measurementCard}
          onClick={() => handleClick("dewpoint")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.measurementHeader}>
            <span className={styles.measurementIcon}>💦</span>
            <span className={styles.measurementLabel}>Dewpoint</span>
            {instrumentCount("dewpoint") > 1 && (
              <span className={styles.badge}>{instrumentCount("dewpoint")}</span>
            )}
          </div>
          <div className={styles.measurementValue}>
            {formatValue(data?.dewpoint, 1, "°C")}
          </div>
          <div className={styles.measurementSparkline}>
            <Sparkline data={dewpointData} width={100} height={28} color="#06b6d4" showMinMax />
          </div>
          {data?.temperature != null && data?.dewpoint != null && (
            <div className={styles.measurementDetail}>
              Spread: {(data.temperature - data.dewpoint).toFixed(1)}°C
            </div>
          )}
        </div>

        {/* Wind Speed */}
        <div
          className={styles.measurementCard}
          onClick={() => handleClick("wind_speed")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.measurementHeader}>
            <span className={styles.measurementIcon}>💨</span>
            <span className={styles.measurementLabel}>Wind Speed</span>
            {instrumentCount("wind_speed") > 1 && (
              <span className={styles.badge}>{instrumentCount("wind_speed")}</span>
            )}
          </div>
          <div className={styles.measurementValue}>
            {formatValue(data?.wind_speed, 1, " km/h")}
          </div>
          <div className={styles.measurementSparkline}>
            <Sparkline data={windData} width={100} height={28} color="#8b5cf6" showMinMax />
          </div>
          {data?.wind_gust != null && (
            <div className={styles.measurementDetail}>
              Gust: {data.wind_gust.toFixed(1)} km/h
            </div>
          )}
        </div>

        {/* Sky Temperature */}
        <div
          className={styles.measurementCard}
          onClick={() => handleClick("sky_temp")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.measurementHeader}>
            <span className={styles.measurementIcon}>🌌</span>
            <span className={styles.measurementLabel}>Sky Temp</span>
            {instrumentCount("sky_temp") > 1 && (
              <span className={styles.badge}>{instrumentCount("sky_temp")}</span>
            )}
          </div>
          <div className={styles.measurementValue}>
            {formatValue(data?.sky_temp, 1, "°C")}
          </div>
          <div className={styles.measurementSparkline}>
            <Sparkline data={skyTempData} width={100} height={28} color="#a855f7" showMinMax />
          </div>
        </div>

        {/* Ambient Temperature */}
        <div
          className={styles.measurementCard}
          onClick={() => handleClick("ambient_temp")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.measurementHeader}>
            <span className={styles.measurementIcon}>🏠</span>
            <span className={styles.measurementLabel}>Ambient</span>
            {instrumentCount("ambient_temp") > 1 && (
              <span className={styles.badge}>{instrumentCount("ambient_temp")}</span>
            )}
          </div>
          <div className={styles.measurementValue}>
            {formatValue(data?.ambient_temp, 1, "°C")}
          </div>
          <div className={styles.measurementSparkline}>
            <Sparkline data={ambientTempData} width={100} height={28} color="#ec4899" showMinMax />
          </div>
        </div>

        {/* Pressure */}
        <div
          className={styles.measurementCard}
          onClick={() => handleClick("pressure")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.measurementHeader}>
            <span className={styles.measurementIcon}>📊</span>
            <span className={styles.measurementLabel}>Pressure</span>
            {instrumentCount("pressure") > 1 && (
              <span className={styles.badge}>{instrumentCount("pressure")}</span>
            )}
          </div>
          <div className={styles.measurementValue}>
            {formatValue(data?.pressure, 1, " hPa")}
          </div>
          <div className={styles.measurementSparkline}>
            <Sparkline data={pressureData} width={100} height={28} color="#14b8a6" showMinMax />
          </div>
        </div>
      </div>
    </div>
  );
}
