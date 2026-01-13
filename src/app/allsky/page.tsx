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

  // Load jQuery and VirtualSky scripts
  useEffect(() => {
    if (scriptsLoaded) return;

    // Check if already loaded
    if (typeof window !== "undefined" && window.$ && "virtualsky" in window.$) {
      setScriptsLoaded(true);
      return;
    }

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
    };

    loadScripts().catch((err) => console.error(err));
  }, [scriptsLoaded]);

  // Initialize VirtualSky when scripts are loaded
  useEffect(() => {
    if (!scriptsLoaded || !containerRef.current || !showOverlay || containerSize === 0) return;

    if (!window.$ || !window.$.virtualsky) {
      console.error("VirtualSky not available");
      return;
    }

    // Clear previous instance
    containerRef.current.innerHTML = "";

    // Create VirtualSky instance using jQuery with explicit dimensions
    vsRef.current = window.$.virtualsky({
      id: "virtualsky-container",
      width: containerSize,
      height: containerSize,
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
      mouse: true,
      live: true,
      fontsize: "12px",
      fontfamily: "Inter, sans-serif",
      gridlines_az: false,
      gridlines_eq: false,
      gridlines_gal: false,
      negative: false,
      ecliptic: false,
      ground: false,
      // Colors for dark theme
      colour: {
        txt: "rgba(255,255,255,0.8)",
        constellation: "rgba(100,180,255,0.7)",
        constellationboundary: "rgba(100,100,100,0.3)",
        cardinal: "rgba(255,200,100,0.9)",
        planet: "rgba(255,200,100,1)",
        planetlabel: "rgba(255,200,100,0.8)",
        meridian: "rgba(100,180,255,0.4)",
      },
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
                transform: `scale(${config.scaleX}, ${config.scaleY})`,
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
