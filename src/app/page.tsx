"use client";

import { useEffect, useState } from "react";
import { siteConfig } from "@/lib/config";
import {
  WeatherData,
  HistoricalReading,
  ApiResponse,
  InstrumentReading,
  FailedInstrument,
  MetricName,
} from "@/types/weather";
import {
  ConditionIndicator,
  WeatherStat,
  SQMGauge,
  SQMGraph,
  AstronomyPanel,
  ObservatoryInfo,
} from "@/components";
import InstrumentAlert from "@/components/InstrumentAlert";
import InstrumentDetailModal from "@/components/InstrumentDetailModal";
import ForecastPanel from "@/components/ForecastPanel";
import AllSkyPanel from "@/components/AllSkyPanel";
import {
  getCloudIcon,
  getWindIcon,
  getRainIcon,
  getDayIcon,
  getConditionColor,
  getHumidityCondition,
  getTempCondition,
  getWindDirection,
} from "@/lib/weatherHelpers";
import { getInstrumentsForMetric, countInstrumentsForMetric } from "@/lib/instruments";
import styles from "./page.module.css";

export default function Dashboard() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [sqmHistory, setSqmHistory] = useState<HistoricalReading[]>([]);
  const [sqmHistoryByInstrument, setSqmHistoryByInstrument] = useState<Record<string, HistoricalReading[]>>({});
  const [allskyUrl, setAllskyUrl] = useState<string>("/api/allsky/latest.jpg");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Multi-instrument state
  const [instrumentReadings, setInstrumentReadings] = useState<Record<string, InstrumentReading>>({});
  const [failedInstruments, setFailedInstruments] = useState<FailedInstrument[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricName | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, siteConfig.refreshInterval);
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      const res = await fetch("/api/current");
      if (res.ok) {
        const json: ApiResponse = await res.json();
        setData(json.current);
        setSqmHistory(json.sqmHistory || []);
        setSqmHistoryByInstrument(json.sqmHistoryByInstrument || {});
        setInstrumentReadings(json.instrumentReadings || {});
        setFailedInstruments(json.failedInstruments || []);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setIsLoading(false);
    }
    // Bust cache on allsky image
    setAllskyUrl(`/api/allsky/latest.jpg?t=${Date.now()}`);
  }

  const handleMetricClick = (metric: MetricName) => {
    setSelectedMetric(metric);
    setIsDetailModalOpen(true);
  };

  const handleInstrumentAlertClick = (code: string) => {
    // Find what metric this instrument measures and show that detail
    const reading = instrumentReadings[code];
    if (reading) {
      // Find the first metric this instrument has
      const metrics: MetricName[] = [
        "temperature", "humidity", "pressure", "sky_quality",
        "wind_speed", "cloud_condition"
      ];
      for (const m of metrics) {
        if (reading[m as keyof InstrumentReading] !== undefined) {
          handleMetricClick(m);
          return;
        }
      }
    }
  };

  const getInstrumentsForCurrentMetric = () => {
    if (!selectedMetric) return [];
    return getInstrumentsForMetric(instrumentReadings, selectedMetric);
  };

  const getInstrumentCount = (metric: string) => {
    return countInstrumentsForMetric(instrumentReadings, metric);
  };

  const getSiteAverageForMetric = (metric: MetricName): number | string | null => {
    if (!data) return null;
    return data[metric as keyof WeatherData] as number | string | null;
  };

  if (isLoading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loader}></div>
        <p>Loading telemetry...</p>
      </div>
    );
  }

  return (
    <div className={styles.dashboard}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.logo}>
          {siteConfig.logoUrl ? (
            <img
              src={siteConfig.logoUrl}
              alt={`${siteConfig.siteName} logo`}
              className={styles.logoImage}
            />
          ) : (
            <div className={styles.logoPlaceholder}>
              <span className={styles.logoIcon}>🔭</span>
            </div>
          )}
          <div className={styles.logoText}>
            <h1>{siteConfig.siteName}</h1>
            <p>{siteConfig.siteSubtitle}</p>
          </div>
        </div>
        {lastUpdate && (
          <div className={styles.lastUpdate}>
            Last update: {lastUpdate.toLocaleTimeString()}
          </div>
        )}
      </header>

      {/* Instrument Alert Banner */}
      <InstrumentAlert
        failedInstruments={failedInstruments}
        onInstrumentClick={handleInstrumentAlertClick}
      />

      <main className={styles.mainGrid}>
        {/* Row 1: Observatory, Astronomy, Sky Quality, AllSky Camera */}

        {/* Observatory Info */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Observatory</h2>
          <ObservatoryInfo />
        </section>

        {/* Astronomy - Sun/Moon Data */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Astronomy</h2>
          <AstronomyPanel />
        </section>

        {/* SQM Panel */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Sky Quality</h2>
          <div className={styles.sqmContent}>
            <div
              className={`${styles.sqmCurrent} ${styles.clickable}`}
              onClick={() => handleMetricClick("sky_quality")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleMetricClick("sky_quality");
                }
              }}
            >
              <div className={styles.sqmValue}>
                {data?.sky_quality?.toFixed(2) ?? "--"}
              </div>
              <div className={styles.sqmUnit}>mag/arcsec²</div>
              {data?.sqm_temperature && (
                <div className={styles.sqmTemp}>
                  Sensor: {data.sqm_temperature.toFixed(1)}°C
                </div>
              )}
              {getInstrumentCount("sky_quality") > 1 && (
                <div className={styles.instrumentBadge}>
                  {getInstrumentCount("sky_quality")} SQMs
                </div>
              )}
            </div>
            <SQMGauge value={data?.sky_quality ?? null} />
            <SQMGraph history={sqmHistory} historyByInstrument={sqmHistoryByInstrument} />
          </div>
        </section>

        {/* AllSky Camera with VirtualSky overlay */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>All-Sky Camera</h2>
          <AllSkyPanel imageUrl={allskyUrl} />
        </section>

        {/* Row 2: Sky Conditions, BOM Radar, BOM Satellite Visible, BOM Satellite Infrared */}

        {/* Cloudwatcher Conditions */}
        <section className={`${styles.panel} ${styles.conditionsPanel}`}>
          <h2 className={styles.panelTitle}>Sky Conditions</h2>
          <div className={styles.conditionsGrid}>
            <ConditionIndicator
              label="Cloud"
              condition={data?.cloud_condition ?? "Unknown"}
              icon={getCloudIcon(data?.cloud_condition)}
              color={getConditionColor(data?.cloud_condition, "cloud")}
              detail={
                data?.sky_temp && data?.ambient_temp
                  ? `Δ ${(data.sky_temp - data.ambient_temp).toFixed(1)}°C`
                  : undefined
              }
              onClick={() => handleMetricClick("cloud_condition")}
            />
            <ConditionIndicator
              label="Wind"
              condition={data?.wind_condition ?? "Unknown"}
              icon={getWindIcon(data?.wind_condition)}
              color={getConditionColor(data?.wind_condition, "wind")}
              detail={
                data?.wind_speed
                  ? `${data.wind_speed.toFixed(1)} km/h`
                  : undefined
              }
              onClick={() => handleMetricClick("wind_condition")}
            />
            <ConditionIndicator
              label="Rain"
              condition={data?.rain_condition ?? "Unknown"}
              icon={getRainIcon(data?.rain_condition)}
              color={getConditionColor(data?.rain_condition, "rain")}
              onClick={() => handleMetricClick("rain_condition")}
            />
            <ConditionIndicator
              label="Humidity"
              condition={getHumidityCondition(data?.humidity)}
              icon="💧"
              color={getConditionColor(
                getHumidityCondition(data?.humidity),
                "humidity"
              )}
              detail={
                data?.humidity ? `${data.humidity.toFixed(0)}%` : undefined
              }
              onClick={() => handleMetricClick("humidity")}
            />
            <ConditionIndicator
              label="Daylight"
              condition={data?.day_condition ?? "Unknown"}
              icon={getDayIcon(data?.day_condition)}
              color={getConditionColor(data?.day_condition, "day")}
              onClick={() => handleMetricClick("day_condition")}
            />
            <ConditionIndicator
              label="Temperature"
              condition={getTempCondition(data?.temperature)}
              icon="🌡️"
              color={getConditionColor(
                getTempCondition(data?.temperature),
                "temp"
              )}
              detail={
                data?.temperature
                  ? `${data.temperature.toFixed(1)}°C`
                  : undefined
              }
              onClick={() => handleMetricClick("temperature")}
            />
          </div>
        </section>

        {/* BOM Radar */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Radar</h2>
          <div className={styles.bomImageContainer}>
            <img
              src={`/api/bom-satellite/IDR691?t=${Math.floor(Date.now() / 60000)}`}
              alt="BOM Radar"
              className={styles.bomImage}
            />
          </div>
        </section>

        {/* BOM Satellite Visible */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Satellite (Visible)</h2>
          <div className={styles.bomImageContainer}>
            <img
              src={`/api/bom-satellite/IDE00005?t=${Math.floor(Date.now() / 60000)}`}
              alt="BOM Satellite Visible"
              className={styles.bomImage}
            />
          </div>
        </section>

        {/* BOM Satellite Infrared */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Satellite (Infrared)</h2>
          <div className={styles.bomImageContainer}>
            <img
              src={`/api/bom-satellite/IDE00006?t=${Math.floor(Date.now() / 60000)}`}
              alt="BOM Satellite Infrared"
              className={styles.bomImage}
            />
          </div>
        </section>

        {/* Row 3: Forecast, Weather Station */}

        {/* 5-Day Forecast */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>5-Day Forecast</h2>
          <ForecastPanel
            latitude={siteConfig.latitude}
            longitude={siteConfig.longitude}
          />
        </section>

        {/* Weather Station */}
        <section className={`${styles.panel} ${styles.weatherPanel}`}>
          <h2 className={styles.panelTitle}>Weather Station</h2>
          {siteConfig.weatherLinkId ? (
            <iframe
              src={`https://www.weatherlink.com/embeddablePage/show/${siteConfig.weatherLinkId}/wide`}
              className={styles.weatherlinkIframe}
              title="WeatherLink data"
            />
          ) : (
            <div className={styles.weatherGrid}>
              <WeatherStat
                label="Temperature"
                value={data?.temperature}
                unit="°C"
                precision={1}
                onClick={() => handleMetricClick("temperature")}
                instrumentCount={getInstrumentCount("temperature")}
              />
              <WeatherStat
                label="Humidity"
                value={data?.humidity}
                unit="%"
                precision={0}
                onClick={() => handleMetricClick("humidity")}
                instrumentCount={getInstrumentCount("humidity")}
              />
              <WeatherStat
                label="Pressure"
                value={data?.pressure}
                unit="hPa"
                precision={1}
                onClick={() => handleMetricClick("pressure")}
                instrumentCount={getInstrumentCount("pressure")}
              />
              <WeatherStat
                label="Dewpoint"
                value={data?.dewpoint}
                unit="°C"
                precision={1}
                onClick={() => handleMetricClick("dewpoint")}
                instrumentCount={getInstrumentCount("dewpoint")}
              />
              <WeatherStat
                label="Wind"
                value={data?.wind_speed}
                unit="km/h"
                precision={1}
                suffix={
                  data?.wind_direction
                    ? ` @ ${getWindDirection(data.wind_direction)}`
                    : ""
                }
                onClick={() => handleMetricClick("wind_speed")}
                instrumentCount={getInstrumentCount("wind_speed")}
              />
              <WeatherStat
                label="Gust"
                value={data?.wind_gust}
                unit="km/h"
                precision={1}
                onClick={() => handleMetricClick("wind_gust")}
                instrumentCount={getInstrumentCount("wind_gust")}
              />
            </div>
          )}
        </section>
      </main>

      <footer className={styles.footer}>
        <p>
          © {new Date().getFullYear()} {siteConfig.siteName}
        </p>
      </footer>

      {/* Instrument Detail Modal */}
      <InstrumentDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        metric={selectedMetric}
        instruments={getInstrumentsForCurrentMetric()}
        siteAverage={selectedMetric ? getSiteAverageForMetric(selectedMetric) : null}
      />
    </div>
  );
}
