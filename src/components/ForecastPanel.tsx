"use client";

import { useEffect, useState } from "react";
import styles from "./ForecastPanel.module.css";

interface DayForecast {
  date: string;
  dayName: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  precipitation: number;
}

interface ForecastPanelProps {
  latitude: number;
  longitude: number;
}

// WMO Weather interpretation codes
// https://open-meteo.com/en/docs#weathervariables
const weatherCodeToIcon: Record<number, { icon: string; description: string }> = {
  0: { icon: "sun", description: "Clear sky" },
  1: { icon: "sun", description: "Mainly clear" },
  2: { icon: "cloud-sun", description: "Partly cloudy" },
  3: { icon: "cloud", description: "Overcast" },
  45: { icon: "fog", description: "Fog" },
  48: { icon: "fog", description: "Depositing rime fog" },
  51: { icon: "drizzle", description: "Light drizzle" },
  53: { icon: "drizzle", description: "Moderate drizzle" },
  55: { icon: "drizzle", description: "Dense drizzle" },
  56: { icon: "sleet", description: "Freezing drizzle" },
  57: { icon: "sleet", description: "Dense freezing drizzle" },
  61: { icon: "rain", description: "Slight rain" },
  63: { icon: "rain", description: "Moderate rain" },
  65: { icon: "rain-heavy", description: "Heavy rain" },
  66: { icon: "sleet", description: "Freezing rain" },
  67: { icon: "sleet", description: "Heavy freezing rain" },
  71: { icon: "snow", description: "Slight snow" },
  73: { icon: "snow", description: "Moderate snow" },
  75: { icon: "snow-heavy", description: "Heavy snow" },
  77: { icon: "snow", description: "Snow grains" },
  80: { icon: "showers", description: "Slight showers" },
  81: { icon: "showers", description: "Moderate showers" },
  82: { icon: "showers-heavy", description: "Violent showers" },
  85: { icon: "snow", description: "Slight snow showers" },
  86: { icon: "snow-heavy", description: "Heavy snow showers" },
  95: { icon: "thunderstorm", description: "Thunderstorm" },
  96: { icon: "thunderstorm", description: "Thunderstorm with hail" },
  99: { icon: "thunderstorm", description: "Thunderstorm with heavy hail" },
};

function getWeatherIcon(code: number): string {
  const weather = weatherCodeToIcon[code] || { icon: "cloud", description: "Unknown" };

  // SVG icons inline for simplicity
  const icons: Record<string, string> = {
    sun: "M12 2v2m0 16v2M4 12H2m20 0h-2m-2.93-6.07 1.41-1.41m-12.02 0 1.41 1.41m12.02 12.02-1.41-1.41m-12.02 0-1.41 1.41M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12z",
    "cloud-sun": "M12 2v1m0 18v1m9-10h1M2 12H1m16.36-5.64.71-.71M5.64 17.64l-.71.71m12.02-.71.71.71M5.64 6.36l-.71-.71M17 12a5 5 0 0 0-9.18-2.71A4 4 0 1 0 6 16h11a3 3 0 1 0 0-6",
    cloud: "M17 21H7A6 6 0 0 1 5.16 9.5a7 7 0 0 1 13.42-.93A4.5 4.5 0 1 1 17 17",
    fog: "M4 4h16M4 8h16M4 12h12M4 16h8",
    drizzle: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M8 19v1m0 3v1m8-5v1m0 3v1m-4-4v1m0 3v1",
    rain: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M16 14v6m-4-4v6m-4-2v6",
    "rain-heavy": "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M9.2 21l3-7m-4.2 2.5 3-7m4.2 4.5 3-7",
    sleet: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M10 15v.01M10 21v.01M14 18v.01M14 21v.01",
    snow: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01",
    "snow-heavy": "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M7 18l5-3 5 3m-5-3v6",
    showers: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M16 17l-4 4-4-4",
    "showers-heavy": "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M12 12v10m4-8v6m-8-4v4",
    thunderstorm: "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242M13 12l-3 5h4l-3 5",
  };

  return icons[weather.icon] || icons.cloud;
}

function getWeatherDescription(code: number): string {
  return weatherCodeToIcon[code]?.description || "Unknown";
}

export default function ForecastPanel({ latitude, longitude }: ForecastPanelProps) {
  const [forecast, setForecast] = useState<DayForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchForecast() {
      try {
        setLoading(true);
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum&timezone=auto&forecast_days=5`;

        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch forecast");

        const data = await response.json();

        const days: DayForecast[] = data.daily.time.map((date: string, i: number) => {
          const d = new Date(date);
          return {
            date,
            dayName: d.toLocaleDateString("en-AU", { weekday: "short" }),
            tempMax: Math.round(data.daily.temperature_2m_max[i]),
            tempMin: Math.round(data.daily.temperature_2m_min[i]),
            weatherCode: data.daily.weather_code[i],
            precipitation: data.daily.precipitation_sum[i],
          };
        });

        setForecast(days);
        setError(null);
      } catch (err) {
        setError("Could not load forecast");
        console.error("Forecast error:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchForecast();
    // Refresh every 30 minutes
    const interval = setInterval(fetchForecast, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [latitude, longitude]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading forecast...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.days}>
        {forecast.map((day) => (
          <div key={day.date} className={styles.day}>
            <div className={styles.dayName}>{day.dayName}</div>
            <svg
              className={styles.icon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={getWeatherIcon(day.weatherCode)} />
            </svg>
            <div className={styles.temps}>
              <span className={styles.tempMax}>{day.tempMax}°</span>
              <span className={styles.tempMin}>{day.tempMin}°</span>
            </div>
            {day.precipitation > 0 && (
              <div className={styles.precip}>{day.precipitation.toFixed(1)}mm</div>
            )}
          </div>
        ))}
      </div>
      <div className={styles.attribution}>
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
          Open-Meteo
        </a>
      </div>
    </div>
  );
}
