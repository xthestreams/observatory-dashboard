"use client";

import { useState, useEffect, useRef } from "react";
import { siteConfig } from "@/lib/config";
import styles from "./AllSkyPanel.module.css";

interface VirtualSkyConfig {
  enabled: boolean;
  azOffset: number;      // Rotation offset to align with camera
  projection: string;    // fisheye, polar, stereo
  showConstellations: boolean;
  showConstellationLabels: boolean;
  showPlanets: boolean;
  showPlanetLabels: boolean;
  showStarLabels: boolean;
  showCardinalPoints: boolean;
  showMeridian: boolean;
  magnitude: number;     // Star magnitude limit
  opacity: number;       // Overlay opacity (0-1)
  scaleX: number;        // Horizontal scale (0.5-1.5)
  scaleY: number;        // Vertical scale (0.5-1.5)
}

interface AllSkyPanelProps {
  imageUrl: string;
}

const DEFAULT_CONFIG: VirtualSkyConfig = {
  enabled: true,
  azOffset: 0,
  projection: "polar",
  showConstellations: true,
  showConstellationLabels: true,
  showPlanets: true,
  showPlanetLabels: true,
  showStarLabels: false,
  showCardinalPoints: true,
  showMeridian: false,
  magnitude: 5,
  opacity: 0.7,
  scaleX: 1.0,
  scaleY: 1.0,
};

// Extend jQuery type for VirtualSky
interface JQueryStatic {
  virtualsky: (opts: Record<string, unknown>) => unknown;
}

declare global {
  interface Window {
    jQuery?: JQueryStatic;
    $?: JQueryStatic;
  }
}

export default function AllSkyPanel({ imageUrl }: AllSkyPanelProps) {
  const [showOverlay, setShowOverlay] = useState(false);
  const [config, setConfig] = useState<VirtualSkyConfig>(DEFAULT_CONFIG);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const vsRef = useRef<unknown>(null);

  // Load VirtualSky config from API
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch("/api/virtualsky/config");
        if (res.ok) {
          const data = await res.json();
          setConfig({ ...DEFAULT_CONFIG, ...data });
        }
      } catch (err) {
        console.error("Failed to load VirtualSky config:", err);
      }
    }
    loadConfig();
  }, []);

  // Load jQuery and VirtualSky scripts when overlay is enabled
  useEffect(() => {
    if (!showOverlay || scriptsLoaded || scriptsLoading) return;

    // Check if already loaded
    if (typeof window !== "undefined" && window.$ && "virtualsky" in window.$) {
      setScriptsLoaded(true);
      return;
    }

    setScriptsLoading(true);

    // Load jQuery first, then VirtualSky
    const loadScripts = async () => {
      // Load jQuery if not present
      if (!window.jQuery) {
        await new Promise<void>((resolve, reject) => {
          const jqueryScript = document.createElement("script");
          jqueryScript.src = "https://code.jquery.com/jquery-3.7.1.min.js";
          jqueryScript.async = true;
          jqueryScript.onload = () => resolve();
          jqueryScript.onerror = () => reject(new Error("Failed to load jQuery"));
          document.head.appendChild(jqueryScript);
        });
      }

      // Load VirtualSky
      await new Promise<void>((resolve, reject) => {
        const vsScript = document.createElement("script");
        vsScript.src = "https://virtualsky.lco.global/virtualsky.min.js";
        vsScript.async = true;
        vsScript.onload = () => resolve();
        vsScript.onerror = () => reject(new Error("Failed to load VirtualSky"));
        document.head.appendChild(vsScript);
      });

      setScriptsLoaded(true);
      setScriptsLoading(false);
    };

    loadScripts().catch((err) => {
      console.error(err);
      setScriptsLoading(false);
    });
  }, [showOverlay, scriptsLoaded, scriptsLoading]);

  // Initialize or update VirtualSky when overlay is shown and scripts are loaded
  useEffect(() => {
    if (!showOverlay || !scriptsLoaded || !containerRef.current) return;

    if (!window.$ || !window.$.virtualsky) {
      console.error("VirtualSky not available");
      return;
    }

    // Clear previous instance
    if (vsRef.current) {
      containerRef.current.innerHTML = "";
    }

    // Create VirtualSky instance using jQuery
    vsRef.current = window.$.virtualsky({
      id: "virtualsky-overlay",
      latitude: siteConfig.latitude,
      longitude: siteConfig.longitude,
      az: config.azOffset,
      projection: config.projection,
      constellations: config.showConstellations,
      constellationlabels: config.showConstellationLabels,
      showplanets: config.showPlanets,
      showplanetlabels: config.showPlanetLabels,
      showstarlabels: config.showStarLabels,
      cardinalpoints: config.showCardinalPoints,
      meridian: config.showMeridian,
      magnitude: config.magnitude,
      transparent: true,
      showdate: false,
      showposition: false,
      keyboard: false,
      mouse: false,
      live: true,
      fontsize: "10px",
      fontfamily: "Inter, sans-serif",
      gridlines_az: false,
      gridlines_eq: false,
      gridlines_gal: false,
      negative: false,
      ecliptic: false,
      ground: false,
      // Colors for dark theme
      colour: {
        txt: "rgba(255,255,255,0.7)",
        constellation: "rgba(100,180,255,0.6)",
        constellationboundary: "rgba(100,100,100,0.3)",
        cardinal: "rgba(255,200,100,0.8)",
        planet: "rgba(255,200,100,0.9)",
        planetlabel: "rgba(255,200,100,0.7)",
        meridian: "rgba(100,180,255,0.3)",
      },
    });
  }, [showOverlay, scriptsLoaded, config]);

  return (
    <div className={styles.container}>
      <div className={styles.imageWrapper}>
        <img
          src={imageUrl}
          alt="All-sky view"
          className={styles.image}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        {showOverlay && (
          <div
            ref={containerRef}
            id="virtualsky-overlay"
            className={styles.overlay}
            style={{
              opacity: config.opacity,
              transform: `scale(${config.scaleX}, ${config.scaleY})`,
            }}
          >
            {scriptsLoading && (
              <div className={styles.loading}>Loading stars...</div>
            )}
          </div>
        )}
      </div>
      <button
        className={`${styles.toggleButton} ${showOverlay ? styles.active : ""}`}
        onClick={() => setShowOverlay(!showOverlay)}
        title={showOverlay ? "Hide star overlay" : "Show star overlay"}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        <span>{showOverlay ? "Hide Stars" : "Show Stars"}</span>
      </button>
    </div>
  );
}
