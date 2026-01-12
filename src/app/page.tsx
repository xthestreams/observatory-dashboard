"use client";

import { useEffect, useState } from "react";
import { siteConfig } from "@/lib/config";
import { WeatherData, HistoricalReading, ApiResponse } from "@/types/weather";
import {
  ConditionIndicator,
  WeatherStat,
  SQMGauge,
  SQMGraph,
  SatellitePanel,
  AstronomyPanel,
  ObservatoryInfo,
} from "@/components";
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
import styles from "./page.module.css";

export default function Dashboard() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [sqmHistory, setSqmHistory] = useState<HistoricalReading[]>([]);
  const [allskyUrl, setAllskyUrl] = useState<string>("/api/allsky/latest.jpg");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

      <main className={styles.mainGrid}>
        {/* SQM Panel */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Sky Quality</h2>
          <div className={styles.sqmContent}>
            <div className={styles.sqmCurrent}>
              <div className={styles.sqmValue}>
                {data?.sky_quality?.toFixed(2) ?? "--"}
              </div>
              <div className={styles.sqmUnit}>mag/arcsec²</div>
              {data?.sqm_temperature && (
                <div className={styles.sqmTemp}>
                  Sensor: {data.sqm_temperature.toFixed(1)}°C
                </div>
              )}
            </div>
            <SQMGauge value={data?.sky_quality ?? null} />
            <SQMGraph history={sqmHistory} />
          </div>
        </section>

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
            />
            <ConditionIndicator
              label="Rain"
              condition={data?.rain_condition ?? "Unknown"}
              icon={getRainIcon(data?.rain_condition)}
              color={getConditionColor(data?.rain_condition, "rain")}
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
            />
            <ConditionIndicator
              label="Daylight"
              condition={data?.day_condition ?? "Unknown"}
              icon={getDayIcon(data?.day_condition)}
              color={getConditionColor(data?.day_condition, "day")}
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
            />
          </div>
        </section>

        {/* Astronomy - Sun/Moon Data */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Astronomy</h2>
          <AstronomyPanel />
        </section>

        {/* Observatory Info */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Observatory</h2>
          <ObservatoryInfo />
        </section>

        {/* AllSky Camera */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>All-Sky Camera</h2>
          <div className={styles.imageContainer}>
            <img
              src={allskyUrl}
              alt="All-sky view"
              className={styles.image}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        </section>

        {/* Clear Outside Forecast */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Forecast</h2>
          <a
            href={`https://clearoutside.com/forecast/${siteConfig.latitude}/${siteConfig.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.forecastLink}
          >
            <img
              src={`https://clearoutside.com/forecast_image_medium/${siteConfig.latitude}/${siteConfig.longitude}/forecast.png`}
              alt="Clear Outside forecast"
              className={styles.forecastImage}
            />
          </a>
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
              />
              <WeatherStat
                label="Humidity"
                value={data?.humidity}
                unit="%"
                precision={0}
              />
              <WeatherStat
                label="Pressure"
                value={data?.pressure}
                unit="hPa"
                precision={1}
              />
              <WeatherStat
                label="Dewpoint"
                value={data?.dewpoint}
                unit="°C"
                precision={1}
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
              />
              <WeatherStat
                label="Gust"
                value={data?.wind_gust}
                unit="km/h"
                precision={1}
              />
            </div>
          )}
        </section>

        {/* BOM Satellite Imagery */}
        <section className={`${styles.panel} ${styles.satellitePanel}`}>
          <h2 className={styles.panelTitle}>BOM Satellite Imagery</h2>
          <SatellitePanel />
        </section>
      </main>

      <footer className={styles.footer}>
        <p>
          © {new Date().getFullYear()} {siteConfig.siteName}
        </p>
      </footer>
    </div>
  );
}
