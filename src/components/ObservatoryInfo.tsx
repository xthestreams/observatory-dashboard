"use client";

import { siteConfig, getDisplayLocation } from "@/lib/config";
import styles from "./ObservatoryInfo.module.css";

export function ObservatoryInfo() {
  const location = getDisplayLocation();
  const hasMpcCodes = siteConfig.mpcCodes && siteConfig.mpcCodes.length > 0;

  return (
    <div className={styles.observatoryInfo}>
      {/* Location */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionIcon}>📍</span>
          <span className={styles.sectionTitle}>Location</span>
        </div>
        <div className={styles.locationGrid}>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Latitude</span>
            <span className={styles.locationValue}>{location.latitude}</span>
          </div>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Longitude</span>
            <span className={styles.locationValue}>{location.longitude}</span>
          </div>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Altitude</span>
            <span className={styles.locationValue}>{location.altitude}</span>
          </div>
          <div className={styles.locationItem}>
            <span className={styles.locationLabel}>Timezone</span>
            <span className={styles.locationValue}>
              UTC{siteConfig.timezone >= 0 ? "+" : ""}
              {siteConfig.timezone}
            </span>
          </div>
        </div>
      </div>

      {/* MPC Codes */}
      {hasMpcCodes && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIcon}>🔭</span>
            <span className={styles.sectionTitle}>MPC Observatory</span>
          </div>
          <div className={styles.mpcCodes}>
            {siteConfig.mpcCodes.map((code) => (
              <a
                key={code}
                href={`https://minorplanetcenter.net/db_search/show_object?object_id=${code}&commit=Show`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.mpcCode}
                title="View on Minor Planet Center"
              >
                <span className={styles.mpcLabel}>MPC</span>
                <span className={styles.mpcValue}>{code}</span>
              </a>
            ))}
          </div>
          <div className={styles.mpcNote}>
            Registered with the{" "}
            <a
              href="https://minorplanetcenter.net/iau/lists/ObsCodesF.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Minor Planet Center
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
