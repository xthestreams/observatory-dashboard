"use client";

import { useState, useEffect } from "react";
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

export default function SetupPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [config, setConfig] = useState<VirtualSkyConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  // Load current config
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch("/api/virtualsky/config");
        if (res.ok) {
          const data = await res.json();
          setConfig({ ...DEFAULT_CONFIG, ...data });
        }
      } catch (err) {
        console.error("Failed to load config:", err);
      }
    }
    loadConfig();
  }, []);

  // Convert decimal degrees to VirtualSky format
  const formatLatitude = (lat: number): string => {
    const abs = Math.abs(lat);
    return lat >= 0 ? `${abs}N` : `${abs}S`;
  };

  const formatLongitude = (lon: number): string => {
    const abs = Math.abs(lon);
    return lon >= 0 ? `${abs}E` : `${abs}W`;
  };

  // Load stuquery and VirtualSky scripts for preview
  useEffect(() => {
    if (scriptLoaded || !previewEnabled) return;

    // Check if already loaded
    const win = window as Window & { S?: { virtualsky?: unknown } };
    if (typeof window !== "undefined" && win.S?.virtualsky) {
      setScriptLoaded(true);
      return;
    }

    // Load stuquery first, then VirtualSky
    const loadScripts = async () => {
      // Load stuquery
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

      setScriptLoaded(true);
    };

    loadScripts().catch((err) => console.error(err));
  }, [previewEnabled, scriptLoaded]);

  // Update preview when config changes
  useEffect(() => {
    if (!previewEnabled || !scriptLoaded) return;

    const container = document.getElementById("preview-container");
    if (!container) return;

    container.innerHTML = "";

    const win = window as Window & { S?: { virtualsky: (opts: Record<string, unknown>) => unknown } };
    if (!win.S?.virtualsky) return;

    win.S.virtualsky({
      id: "preview-container",
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
      transparent: false,
      showdate: false,
      showposition: false,
      keyboard: false,
      mouse: true,
      live: true,
      width: 400,
      height: 400,
      fontsize: "10px",
      gridlines_az: false,
      gridlines_eq: false,
      gridlines_gal: false,
      ground: false,
    });
  }, [previewEnabled, scriptLoaded, config]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");

    // Test the password by trying to save current config
    try {
      const res = await fetch("/api/virtualsky/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${password}`,
        },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        setAuthenticated(true);
        // Store password in session for future saves
        sessionStorage.setItem("setup_password", password);
      } else {
        setAuthError("Invalid password");
      }
    } catch (err) {
      setAuthError("Authentication failed");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");

    const storedPassword = sessionStorage.getItem("setup_password") || password;

    try {
      const res = await fetch("/api/virtualsky/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${storedPassword}`,
        },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        setSaveStatus("success");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
      }
    } catch (err) {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  if (!authenticated) {
    return (
      <div className={styles.loginContainer}>
        <form onSubmit={handleAuth} className={styles.loginForm}>
          <h1>Setup Access</h1>
          <p>Enter the setup password to configure the dashboard.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className={styles.input}
            autoFocus
          />
          {authError && <p className={styles.error}>{authError}</p>}
          <button type="submit" className={styles.button}>
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Dashboard Setup</h1>
        <a href="/" className={styles.backLink}>
          Back to Dashboard
        </a>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <h2>VirtualSky Overlay Configuration</h2>
          <p className={styles.description}>
            Configure the star chart overlay for the All-Sky camera image. Adjust the
            azimuth offset to align constellations with your camera orientation.
          </p>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                />
                Enable VirtualSky overlay
              </label>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="azOffset">Azimuth Offset (degrees)</label>
              <input
                type="range"
                id="azOffset"
                min="-180"
                max="180"
                value={config.azOffset}
                onChange={(e) => setConfig({ ...config, azOffset: Number(e.target.value) })}
                className={styles.slider}
              />
              <span className={styles.sliderValue}>{config.azOffset}°</span>
              <p className={styles.hint}>
                Rotate the star chart to align with camera. 0° = North at top.
              </p>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="projection">Projection</label>
              <select
                id="projection"
                value={config.projection}
                onChange={(e) => setConfig({ ...config, projection: e.target.value })}
                className={styles.select}
              >
                <option value="polar">Polar (recommended for all-sky)</option>
                <option value="stereo">Stereographic</option>
                <option value="fisheye">Fisheye</option>
                <option value="ortho">Orthographic</option>
                <option value="lambert">Lambert</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="opacity">Overlay Opacity</label>
              <input
                type="range"
                id="opacity"
                min="0"
                max="1"
                step="0.1"
                value={config.opacity}
                onChange={(e) => setConfig({ ...config, opacity: Number(e.target.value) })}
                className={styles.slider}
              />
              <span className={styles.sliderValue}>{(config.opacity * 100).toFixed(0)}%</span>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="scaleX">Horizontal Scale</label>
              <input
                type="range"
                id="scaleX"
                min="0.5"
                max="1.5"
                step="0.05"
                value={config.scaleX}
                onChange={(e) => setConfig({ ...config, scaleX: Number(e.target.value) })}
                className={styles.slider}
              />
              <span className={styles.sliderValue}>{(config.scaleX * 100).toFixed(0)}%</span>
              <p className={styles.hint}>
                Stretch or compress overlay horizontally to match camera FOV.
              </p>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="scaleY">Vertical Scale</label>
              <input
                type="range"
                id="scaleY"
                min="0.5"
                max="1.5"
                step="0.05"
                value={config.scaleY}
                onChange={(e) => setConfig({ ...config, scaleY: Number(e.target.value) })}
                className={styles.slider}
              />
              <span className={styles.sliderValue}>{(config.scaleY * 100).toFixed(0)}%</span>
              <p className={styles.hint}>
                Stretch or compress overlay vertically to match camera FOV.
              </p>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="magnitude">Star Magnitude Limit</label>
              <input
                type="range"
                id="magnitude"
                min="1"
                max="7"
                step="0.5"
                value={config.magnitude}
                onChange={(e) => setConfig({ ...config, magnitude: Number(e.target.value) })}
                className={styles.slider}
              />
              <span className={styles.sliderValue}>{config.magnitude}</span>
              <p className={styles.hint}>Higher values show fainter stars.</p>
            </div>

            <div className={styles.formGroup}>
              <label>Display Options</label>
              <div className={styles.checkboxGrid}>
                <label>
                  <input
                    type="checkbox"
                    checked={config.showConstellations}
                    onChange={(e) =>
                      setConfig({ ...config, showConstellations: e.target.checked })
                    }
                  />
                  Constellation lines
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.showConstellationLabels}
                    onChange={(e) =>
                      setConfig({ ...config, showConstellationLabels: e.target.checked })
                    }
                  />
                  Constellation labels
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.showPlanets}
                    onChange={(e) =>
                      setConfig({ ...config, showPlanets: e.target.checked })
                    }
                  />
                  Planets
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.showPlanetLabels}
                    onChange={(e) =>
                      setConfig({ ...config, showPlanetLabels: e.target.checked })
                    }
                  />
                  Planet labels
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.showStarLabels}
                    onChange={(e) =>
                      setConfig({ ...config, showStarLabels: e.target.checked })
                    }
                  />
                  Star labels
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.showCardinalPoints}
                    onChange={(e) =>
                      setConfig({ ...config, showCardinalPoints: e.target.checked })
                    }
                  />
                  Cardinal points (N/S/E/W)
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.showMeridian}
                    onChange={(e) =>
                      setConfig({ ...config, showMeridian: e.target.checked })
                    }
                  />
                  Meridian
                </label>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <button
              onClick={() => setPreviewEnabled(!previewEnabled)}
              className={styles.previewButton}
            >
              {previewEnabled ? "Hide Preview" : "Show Preview"}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={styles.saveButton}
            >
              {saving ? "Saving..." : "Save Configuration"}
            </button>
            {saveStatus === "success" && (
              <span className={styles.successMsg}>Saved!</span>
            )}
            {saveStatus === "error" && (
              <span className={styles.errorMsg}>Save failed</span>
            )}
          </div>

          {previewEnabled && (
            <div className={styles.preview}>
              <h3>Preview</h3>
              <div id="preview-container" className={styles.previewCanvas} />
              <p className={styles.hint}>
                Drag to rotate. This shows the VirtualSky overlay - the actual all-sky
                image would appear behind this.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
