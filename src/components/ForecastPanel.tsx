"use client";

import { useEffect, useState } from "react";
import styles from "./ForecastPanel.module.css";

interface HourlyForecast {
  time: string;
  hour: string;
  temperature: number;
  humidity: number;
  dewPoint: number;
  cloudCover: number;
  precipProbability: number;
  precipitation: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
}

interface DayForecast {
  date: string;
  dayName: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  precipitation: number;
  precipProbability: number;
}

interface ForecastPanelProps {
  latitude: number;
  longitude: number;
}

// WMO Weather interpretation codes
const weatherCodeToIcon: Record<number, { icon: string; description: string }> = {
  0: { icon: "sun", description: "Clear" },
  1: { icon: "sun", description: "Clear" },
  2: { icon: "cloud-sun", description: "Partly cloudy" },
  3: { icon: "cloud", description: "Overcast" },
  45: { icon: "fog", description: "Fog" },
  48: { icon: "fog", description: "Fog" },
  51: { icon: "drizzle", description: "Drizzle" },
  53: { icon: "drizzle", description: "Drizzle" },
  55: { icon: "drizzle", description: "Drizzle" },
  56: { icon: "sleet", description: "Freezing drizzle" },
  57: { icon: "sleet", description: "Freezing drizzle" },
  61: { icon: "rain", description: "Rain" },
  63: { icon: "rain", description: "Rain" },
  65: { icon: "rain-heavy", description: "Heavy rain" },
  66: { icon: "sleet", description: "Freezing rain" },
  67: { icon: "sleet", description: "Freezing rain" },
  71: { icon: "snow", description: "Snow" },
  73: { icon: "snow", description: "Snow" },
  75: { icon: "snow-heavy", description: "Heavy snow" },
  77: { icon: "snow", description: "Snow" },
  80: { icon: "showers", description: "Showers" },
  81: { icon: "showers", description: "Showers" },
  82: { icon: "showers-heavy", description: "Heavy showers" },
  85: { icon: "snow", description: "Snow showers" },
  86: { icon: "snow-heavy", description: "Heavy snow" },
  95: { icon: "thunderstorm", description: "Thunderstorm" },
  96: { icon: "thunderstorm", description: "Thunderstorm" },
  99: { icon: "thunderstorm", description: "Thunderstorm" },
};

function getWeatherIconPath(code: number): string {
  const weather = weatherCodeToIcon[code] || { icon: "cloud", description: "Unknown" };

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

function getCloudCoverColor(percent: number): string {
  if (percent <= 20) return "#22c55e"; // Green - clear
  if (percent <= 50) return "#84cc16"; // Lime - mostly clear
  if (percent <= 70) return "#f59e0b"; // Amber - partly cloudy
  if (percent <= 85) return "#f97316"; // Orange - mostly cloudy
  return "#ef4444"; // Red - overcast
}

function getWindDirection(degrees: number): string {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degrees / 45) % 8;
  return directions[index];
}

export default function ForecastPanel({ latitude, longitude }: ForecastPanelProps) {
  const [hourlyForecast, setHourlyForecast] = useState<HourlyForecast[]>([]);
  const [dailyForecast, setDailyForecast] = useState<DayForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchForecast() {
      try {
        setLoading(true);

        // Fetch both hourly and daily data
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=6`;

        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch forecast");

        const data = await response.json();

        // Process hourly data - get next 12 hours
        const now = new Date();
        const hourlyData: HourlyForecast[] = [];

        for (let i = 0; i < data.hourly.time.length && hourlyData.length < 12; i++) {
          const forecastTime = new Date(data.hourly.time[i]);
          if (forecastTime >= now) {
            hourlyData.push({
              time: data.hourly.time[i],
              hour: forecastTime.toLocaleTimeString("en-AU", { hour: "numeric", hour12: true }),
              temperature: Math.round(data.hourly.temperature_2m[i]),
              humidity: Math.round(data.hourly.relative_humidity_2m[i]),
              dewPoint: Math.round(data.hourly.dew_point_2m[i]),
              cloudCover: Math.round(data.hourly.cloud_cover[i]),
              precipProbability: Math.round(data.hourly.precipitation_probability[i]),
              precipitation: data.hourly.precipitation[i],
              windSpeed: Math.round(data.hourly.wind_speed_10m[i]),
              windDirection: data.hourly.wind_direction_10m[i],
              weatherCode: data.hourly.weather_code[i],
            });
          }
        }

        // Process daily data - skip today, get next 5 days
        const dailyData: DayForecast[] = data.daily.time.slice(1, 6).map((date: string, i: number) => {
          const idx = i + 1; // Skip first day (today)
          const d = new Date(date);
          return {
            date,
            dayName: d.toLocaleDateString("en-AU", { weekday: "short" }),
            tempMax: Math.round(data.daily.temperature_2m_max[idx]),
            tempMin: Math.round(data.daily.temperature_2m_min[idx]),
            weatherCode: data.daily.weather_code[idx],
            precipitation: data.daily.precipitation_sum[idx],
            precipProbability: data.daily.precipitation_probability_max[idx],
          };
        });

        setHourlyForecast(hourlyData);
        setDailyForecast(dailyData);
        setError(null);
      } catch (err) {
        setError("Could not load forecast");
        console.error("Forecast error:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchForecast();
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
      {/* Hourly Detail Section */}
      <div className={styles.hourlySection}>
        <div className={styles.sectionHeader}>Next 12 Hours</div>
        <div className={styles.hourlyGrid}>
          {hourlyForecast.map((hour, idx) => (
            <div key={hour.time} className={`${styles.hourCard} ${idx === 0 ? styles.currentHour : ""}`}>
              <div className={styles.hourTime}>{idx === 0 ? "Now" : hour.hour}</div>
              <svg
                className={styles.hourIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={getWeatherIconPath(hour.weatherCode)} />
              </svg>
              <div className={styles.hourTemp}>{hour.temperature}°</div>
              <div className={styles.hourDetails}>
                <div
                  className={styles.cloudBar}
                  title={`Cloud: ${hour.cloudCover}%`}
                >
                  <div
                    className={styles.cloudFill}
                    style={{
                      width: `${hour.cloudCover}%`,
                      backgroundColor: getCloudCoverColor(hour.cloudCover),
                    }}
                  />
                  <span className={styles.cloudText}>{hour.cloudCover}%</span>
                </div>
                <div className={styles.hourMeta}>
                  <span title="Humidity">{hour.humidity}%</span>
                  <span title={`Wind ${getWindDirection(hour.windDirection)}`}>{hour.windSpeed}km/h</span>
                </div>
                {hour.precipProbability > 0 && (
                  <div className={styles.hourPrecip} title="Precipitation probability">
                    {hour.precipProbability}%
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Summary Section */}
      <div className={styles.dailySection}>
        <div className={styles.sectionHeader}>5-Day Outlook</div>
        <div className={styles.dailyGrid}>
          {dailyForecast.map((day) => (
            <div key={day.date} className={styles.dayCard}>
              <div className={styles.dayName}>{day.dayName}</div>
              <svg
                className={styles.dayIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={getWeatherIconPath(day.weatherCode)} />
              </svg>
              <div className={styles.dayTemps}>
                <span className={styles.dayTempMax}>{day.tempMax}°</span>
                <span className={styles.dayTempMin}>{day.tempMin}°</span>
              </div>
              {day.precipProbability > 20 && (
                <div className={styles.dayPrecip}>{day.precipProbability}%</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.attribution}>
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
          Open-Meteo
        </a>
      </div>
    </div>
  );
}
