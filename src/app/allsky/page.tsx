"use client";

import { useState, useEffect, useRef } from "react";
import { siteConfig } from "@/lib/config";
import styles from "./page.module.css";

interface VirtualSkyConfig {
  enabled: boolean;
  azOffset: number;
  projection: string;
  showConstellations: boolean;
  showConstellationLabels: boolean;
  showPlanets: boolean;
  showPlanetLabels: boolean;
  showStarLabels: boolean;
  showCardinalPoints: boolean;
  showMeridian: boolean;
  magnitude: number;
  opacity: number;
  scaleX: number;
  scaleY: number;
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

// VirtualSky uses stuquery (S) not jQuery ($)
interface StuQueryStatic {
  virtualsky: (opts: Record<string, unknown>) => unknown;
}

declare global {
  interface Window {
    S?: StuQueryStatic;
  }
}

export default function AllSkyPage() {
  const [config, setConfig] = useState<VirtualSkyConfig>(DEFAULT_CONFIG);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [imageUrl, setImageUrl] = useState("/api/allsky/latest.jpg");
  const [containerSize, setContainerSize] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const vsRef = useRef<unknown>(null);

  // Add cache-busting timestamp to image URL
  useEffect(() => {
    setImageUrl(`/api/allsky/latest.jpg?t=${Date.now()}`);
  }, []);

  // Calculate container size based on viewport
  useEffect(() => {
    const updateSize = () => {
      if (imageContainerRef.current) {
        const rect = imageContainerRef.current.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height, 800);
        setContainerSize(size);
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

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

  // Load stuquery and VirtualSky scripts (same as AllSky software)
  useEffect(() => {
    if (scriptsLoaded) return;

    // Check if already loaded
    if (typeof window !== "undefined" && window.S && "virtualsky" in window.S) {
      setScriptsLoaded(true);
      return;
    }

    // Load stuquery first, then VirtualSky
    const loadScripts = async () => {
      // Load stuquery (lightweight jQuery alternative used by VirtualSky)
      await new Promise<void>((resolve, reject) => {
        const stuqueryScript = document.createElement("script");
        stuqueryScript.src = "https://slowe.github.io/VirtualSky/stuquery.min.js";
        stuqueryScript.async = true;
        stuqueryScript.onload = () => resolve();
        stuqueryScript.onerror = () => reject(new Error("Failed to load stuquery"));
        document.head.appendChild(stuqueryScript);
      });

      // Load VirtualSky
      await new Promise<void>((resolve, reject) => {
        const vsScript = document.createElement("script");
        vsScript.src = "https://slowe.github.io/VirtualSky/virtualsky.min.js";
        vsScript.async = true;
        vsScript.onload = () => resolve();
        vsScript.onerror = () => reject(new Error("Failed to load VirtualSky"));
        document.head.appendChild(vsScript);
      });

      setScriptsLoaded(true);
    };

    loadScripts().catch((err) => console.error(err));
  }, [scriptsLoaded]);

  // Convert decimal degrees to VirtualSky format (e.g., -31.25 -> "31.25S")
  const formatLatitude = (lat: number): string => {
    const abs = Math.abs(lat);
    return lat >= 0 ? `${abs}N` : `${abs}S`;
  };

  const formatLongitude = (lon: number): string => {
    const abs = Math.abs(lon);
    return lon >= 0 ? `${abs}E` : `${abs}W`;
  };

  // Initialize VirtualSky when scripts are loaded
  useEffect(() => {
    if (!scriptsLoaded || !containerRef.current || !showOverlay || containerSize === 0) return;

    if (!window.S || !window.S.virtualsky) {
      console.error("VirtualSky not available");
      return;
    }

    // Clear previous instance
    containerRef.current.innerHTML = "";

    // Create VirtualSky instance using S.virtualsky (stuquery)
    vsRef.current = window.S.virtualsky({
      id: "virtualsky-container",
      width: containerSize,
      height: containerSize,
      latitude: formatLatitude(siteConfig.latitude),
      longitude: formatLongitude(siteConfig.longitude),
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
      mouse: true,
      live: true,
      fontsize: "14px",
      gridlines_az: false,
      gridlines_eq: false,
      gridlines_gal: false,
      negative: false,
      ecliptic: false,
      ground: false,
    });
  }, [scriptsLoaded, showOverlay, config, containerSize]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{siteConfig.siteName} - All-Sky Camera</h1>
        <div className={styles.controls}>
          <button
            className={`${styles.toggleButton} ${showOverlay ? styles.active : ""}`}
            onClick={() => setShowOverlay(!showOverlay)}
          >
            {showOverlay ? "Hide Stars" : "Show Stars"}
          </button>
          <a href="/" className={styles.backLink}>
            Back to Dashboard
          </a>
        </div>
      </header>

      <main className={styles.main}>
        <div ref={imageContainerRef} className={styles.imageContainer}>
          <img
            src={imageUrl}
            alt="All-sky view"
            className={styles.image}
          />
          {showOverlay && scriptsLoaded && (
            <div
              ref={containerRef}
              id="virtualsky-container"
              className={styles.overlay}
              style={{
                width: containerSize,
                height: containerSize,
                opacity: config.opacity,
                transform: `translate(-50%, -50%) scale(${config.scaleX}, ${config.scaleY})`,
              }}
            />
          )}
          {showOverlay && !scriptsLoaded && (
            <div className={styles.loading}>Loading star overlay...</div>
          )}
        </div>
        <p className={styles.hint}>
          Drag to rotate the star chart. The overlay shows the current night sky
          aligned with the camera view.
        </p>
      </main>
    </div>
  );
}
