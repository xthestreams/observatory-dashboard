"use client";

import { useState, useEffect } from "react";
import { siteConfig } from "@/lib/config";
import styles from "./AstronomyPanel.module.css";

// Types for USNO API response
interface SunMoonData {
  sundata: Array<{ phen: string; time: string }>;
  moondata: Array<{ phen: string; time: string }>;
  curphase: string;
  fracillum: string;
  closestphase: {
    phase: string;
    day: number;
    month: number;
    year: number;
    time: string;
  };
  day_of_week: string;
}

interface AstronomyData {
  sunrise: string | null;
  sunset: string | null;
  civilTwilightBegin: string | null;
  civilTwilightEnd: string | null;
  moonrise: string | null;
  moonset: string | null;
  moonPhase: string;
  moonIllumination: string;
  nextPhase: string;
  nextPhaseDate: string;
  dayLength: string | null;
}

function parseTime(timeStr: string): Date | null {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  now.setHours(hours, minutes, 0, 0);
  return now;
}

function calculateDayLength(sunrise: string | null, sunset: string | null): string | null {
  if (!sunrise || !sunset) return null;
  const sunriseTime = parseTime(sunrise);
  const sunsetTime = parseTime(sunset);
  if (!sunriseTime || !sunsetTime) return null;

  const diffMs = sunsetTime.getTime() - sunriseTime.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function getMoonPhaseEmoji(phase: string): string {
  const phaseLower = phase.toLowerCase();
  if (phaseLower.includes("new")) return "🌑";
  if (phaseLower.includes("waxing crescent")) return "🌒";
  if (phaseLower.includes("first quarter")) return "🌓";
  if (phaseLower.includes("waxing gibbous")) return "🌔";
  if (phaseLower.includes("full")) return "🌕";
  if (phaseLower.includes("waning gibbous")) return "🌖";
  if (phaseLower.includes("last quarter") || phaseLower.includes("third quarter")) return "🌗";
  if (phaseLower.includes("waning crescent")) return "🌘";
  return "🌙";
}

function formatDate(day: number, month: number): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[month - 1]} ${day}`;
}

export function AstronomyPanel() {
  const [data, setData] = useState<AstronomyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAstronomyData() {
      try {
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
        const coords = `${siteConfig.latitude},${siteConfig.longitude}`;
        const tz = siteConfig.timezone;

        const response = await fetch(
          `https://aa.usno.navy.mil/api/rstt/oneday?date=${dateStr}&coords=${coords}&tz=${tz}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch astronomy data");
        }

        const json = await response.json();
        const props = json.properties?.data as SunMoonData;

        if (!props) {
          throw new Error("Invalid response format");
        }

        // Extract sun data
        const sunDataMap: Record<string, string> = {};
        props.sundata?.forEach((item) => {
          sunDataMap[item.phen] = item.time;
        });

        // Extract moon data
        const moonDataMap: Record<string, string> = {};
        props.moondata?.forEach((item) => {
          moonDataMap[item.phen] = item.time;
        });

        const sunrise = sunDataMap["Rise"] || null;
        const sunset = sunDataMap["Set"] || null;

        setData({
          sunrise,
          sunset,
          civilTwilightBegin: sunDataMap["Begin Civil Twilight"] || null,
          civilTwilightEnd: sunDataMap["End Civil Twilight"] || null,
          moonrise: moonDataMap["Rise"] || null,
          moonset: moonDataMap["Set"] || null,
          moonPhase: props.curphase || "Unknown",
          moonIllumination: props.fracillum || "--",
          nextPhase: props.closestphase?.phase || "Unknown",
          nextPhaseDate: props.closestphase
            ? formatDate(props.closestphase.day, props.closestphase.month)
            : "--",
          dayLength: calculateDayLength(sunrise, sunset),
        });
        setLoading(false);
      } catch (err) {
        console.error("Astronomy data fetch error:", err);
        setError("Unable to load astronomy data");
        setLoading(false);
      }
    }

    fetchAstronomyData();
  }, []);

  if (loading) {
    return (
      <div className={styles.astronomyPanel}>
        <div className={styles.loading}>Loading astronomy data...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.astronomyPanel}>
        <div className={styles.error}>{error || "No data available"}</div>
      </div>
    );
  }

  return (
    <div className={styles.astronomyPanel}>
      {/* Sun Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>☀️</span>
          <span className={styles.sectionTitle}>Sun</span>
        </div>
        <div className={styles.dataGrid}>
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>Twilight Begin</span>
            <span className={styles.dataValue}>{data.civilTwilightBegin || "--"}</span>
          </div>
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>Sunrise</span>
            <span className={styles.dataValue}>{data.sunrise || "--"}</span>
          </div>
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>Sunset</span>
            <span className={styles.dataValue}>{data.sunset || "--"}</span>
          </div>
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>Twilight End</span>
            <span className={styles.dataValue}>{data.civilTwilightEnd || "--"}</span>
          </div>
        </div>
        {data.dayLength && (
          <div className={styles.dayLength}>
            Day Length: <strong>{data.dayLength}</strong>
          </div>
        )}
      </div>

      {/* Moon Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>{getMoonPhaseEmoji(data.moonPhase)}</span>
          <span className={styles.sectionTitle}>Moon</span>
        </div>
        <div className={styles.moonPhaseDisplay}>
          <div className={styles.phaseEmoji}>{getMoonPhaseEmoji(data.moonPhase)}</div>
          <div className={styles.phaseInfo}>
            <div className={styles.phaseName}>{data.moonPhase}</div>
            <div className={styles.illumination}>{data.moonIllumination} illuminated</div>
          </div>
        </div>
        <div className={styles.dataGrid}>
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>Moonrise</span>
            <span className={styles.dataValue}>{data.moonrise || "--"}</span>
          </div>
          <div className={styles.dataItem}>
            <span className={styles.dataLabel}>Moonset</span>
            <span className={styles.dataValue}>{data.moonset || "--"}</span>
          </div>
        </div>
        <div className={styles.nextPhase}>
          Next: <strong>{data.nextPhase}</strong> on {data.nextPhaseDate}
        </div>
      </div>
    </div>
  );
}
