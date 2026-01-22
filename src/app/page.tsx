"use client";

import { useEffect, useState, useCallback } from "react";
import { siteConfig } from "@/lib/config";
import {
  WeatherData,
  HistoricalReading,
  WeatherHistory,
  ApiResponse,
  InstrumentReading,
  FailedInstrument,
  MetricName,
  TelemetryHealth,
} from "@/types/weather";
import {
  WeatherStat,
  SQMGauge,
  SQMGraph,
  AstronomyPanel,
  SkyConditionsPanel,
  HeaderBar,
  AlertConditions,
} from "@/components";
import InstrumentAlert from "@/components/InstrumentAlert";
import InstrumentDetailModal from "@/components/InstrumentDetailModal";
import ForecastPanel from "@/components/ForecastPanel";
import AllSkyPanel from "@/components/AllSkyPanel";
import { ErrorBoundary, DashboardErrorFallback } from "@/components/ErrorBoundary";
import { DashboardSkeleton } from "@/components/Skeleton";
import {
  getWindDirection,
} from "@/lib/weatherHelpers";
import { getInstrumentsForMetric, countInstrumentsForMetric } from "@/lib/instruments";
import styles from "./page.module.css";

export default function Dashboard() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [sqmHistory, setSqmHistory] = useState<HistoricalReading[]>([]);
  const [sqmHistoryByInstrument, setSqmHistoryByInstrument] = useState<Record<string, HistoricalReading[]>>({});
  const [weatherHistory, setWeatherHistory] = useState<WeatherHistory[]>([]);
  const [allskyUrl] = useState<string>("/api/allsky/latest.jpg");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // History window state (persisted to localStorage)
  const [historyHours, setHistoryHours] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("historyHours");
      return saved ? parseInt(saved, 10) : 1;
    }
    return 1;
  });

  // Multi-instrument state
  const [instrumentReadings, setInstrumentReadings] = useState<Record<string, InstrumentReading>>({});
  const [failedInstruments, setFailedInstruments] = useState<FailedInstrument[]>([]);
  const [telemetryHealth, setTelemetryHealth] = useState<TelemetryHealth | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricName | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/current?historyHours=${historyHours}`);
      if (res.ok) {
        const json: ApiResponse = await res.json();
        setData(json.current);
        setSqmHistory(json.sqmHistory || []);
        setSqmHistoryByInstrument(json.sqmHistoryByInstrument || {});
        setWeatherHistory(json.weatherHistory || []);
        setInstrumentReadings(json.instrumentReadings || {});
        setFailedInstruments(json.failedInstruments || []);
        setTelemetryHealth(json.telemetryHealth || null);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [historyHours]);

  // Handler for when a new AllSky image is detected
  const handleNewAllSkyImage = useCallback(() => {
    // Refresh all dashboard data when new image arrives
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, siteConfig.refreshInterval);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Handle history window change
  const handleHistoryChange = (hours: number) => {
    setHistoryHours(hours);
    localStorage.setItem("historyHours", hours.toString());
  };

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
    return <DashboardSkeleton />;
  }

  return (
    <ErrorBoundary fallback={<DashboardErrorFallback />}>
    <div className={styles.dashboard}>
      {/* Instrument Alert Banner */}
      <InstrumentAlert
        failedInstruments={failedInstruments}
        onInstrumentClick={handleInstrumentAlertClick}
      />

      {/* Row 0: Full-width Header Bar */}
      <HeaderBar
        telemetryHealth={telemetryHealth}
        lastUpdate={lastUpdate}
        historyHours={historyHours}
        onHistoryChange={handleHistoryChange}
      />

      <main className={styles.mainGrid}>
        {/* Row 1: Alert Conditions, SQM, Radar, AllSky */}

        {/* Alert Conditions (Cloud, Wind, Rain, Daylight + Compass) */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Conditions</h2>
          <AlertConditions
            data={data}
            weatherHistory={weatherHistory}
            historyHours={historyHours}
            onMetricClick={handleMetricClick}
          />
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

        {/* BOM Radar */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Radar</h2>
          <div className={styles.bomImageContainer}>
            <img
              src="/api/bom-satellite/IDR691"
              alt="BOM Radar"
              className={styles.bomImage}
            />
          </div>
        </section>

        {/* AllSky Camera */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>All-Sky Camera</h2>
          <AllSkyPanel imageUrl={allskyUrl} onNewImage={handleNewAllSkyImage} />
        </section>

        {/* Row 2: Sky Conditions (Measurements) - Full Width */}
        <section className={`${styles.panel} ${styles.skyConditionsPanel}`}>
          <h2 className={styles.panelTitle}>Measurements</h2>
          <SkyConditionsPanel
            data={data}
            weatherHistory={weatherHistory}
            onMetricClick={handleMetricClick}
            getInstrumentCount={getInstrumentCount}
            historyHours={historyHours}
          />
        </section>

        {/* Row 3: Forecast (spans 2 columns), Satellites, Astronomy */}

        {/* Forecast - Hourly + 5-Day */}
        <section className={`${styles.panel} ${styles.forecastPanel}`}>
          <h2 className={styles.panelTitle}>Weather Forecast</h2>
          <ForecastPanel
            latitude={siteConfig.latitude}
            longitude={siteConfig.longitude}
          />
        </section>

        {/* BOM Satellite Visible */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Satellite (Visible)</h2>
          <div className={styles.bomImageContainer}>
            <img
              src="/api/bom-satellite/IDE00005"
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
              src="/api/bom-satellite/IDE00006"
              alt="BOM Satellite Infrared"
              className={styles.bomImage}
            />
          </div>
        </section>

        {/* Astronomy - Sun/Moon Data */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Astronomy</h2>
          <AstronomyPanel />
        </section>

        {/* Row 4: Weather Station (Davis) */}
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
    </ErrorBoundary>
  );
}
