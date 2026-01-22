"use client";

import styles from "./Skeleton.module.css";

/**
 * Skeleton loading components for dashboard panels.
 *
 * Shows animated placeholder content while data is loading,
 * improving perceived performance and reducing layout shift.
 */

interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
}

export function SkeletonLine({ width = "100%", height = "20px", borderRadius = "4px" }: SkeletonProps) {
  return (
    <div
      className={styles.skeleton}
      style={{ width, height, borderRadius }}
    />
  );
}

export function SkeletonCircle({ width = "60px", height = "60px" }: SkeletonProps) {
  return (
    <div
      className={styles.skeleton}
      style={{ width, height, borderRadius: "50%" }}
    />
  );
}

export function ConditionsSkeleton() {
  return (
    <div className={styles.conditionsGrid}>
      {/* Condition items */}
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={styles.conditionItem}>
          <SkeletonLine width="60px" height="16px" />
          <SkeletonLine width="80px" height="24px" />
        </div>
      ))}
      {/* Wind compass placeholder */}
      <div className={styles.compassPlaceholder}>
        <SkeletonCircle width="80px" height="80px" />
      </div>
    </div>
  );
}

export function SQMSkeleton() {
  return (
    <div className={styles.sqmContainer}>
      <div className={styles.sqmGauge}>
        <SkeletonCircle width="120px" height="120px" />
      </div>
      <div className={styles.sqmGraph}>
        <SkeletonLine width="100%" height="150px" borderRadius="8px" />
      </div>
    </div>
  );
}

export function WeatherStatsSkeleton() {
  return (
    <div className={styles.statsGrid}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className={styles.statItem}>
          <SkeletonLine width="50px" height="14px" />
          <SkeletonLine width="70px" height="28px" />
          <SkeletonLine width="100%" height="40px" borderRadius="4px" />
        </div>
      ))}
    </div>
  );
}

export function ForecastSkeleton() {
  return (
    <div className={styles.forecastContainer}>
      <div className={styles.forecastHeader}>
        <SkeletonLine width="150px" height="20px" />
      </div>
      <div className={styles.forecastDays}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.forecastDay}>
            <SkeletonLine width="40px" height="14px" />
            <SkeletonCircle width="40px" height="40px" />
            <SkeletonLine width="50px" height="16px" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ImageSkeleton() {
  return (
    <div className={styles.imagePlaceholder}>
      <SkeletonLine width="100%" height="100%" borderRadius="8px" />
    </div>
  );
}

export function PanelSkeleton({ title }: { title: string }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>
        <SkeletonLine width="100px" height="18px" />
      </div>
      <div className={styles.panelContent}>
        <SkeletonLine width="100%" height="120px" borderRadius="8px" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className={styles.dashboardSkeleton}>
      {/* Header bar skeleton */}
      <div className={styles.headerSkeleton}>
        <SkeletonLine width="200px" height="24px" />
        <div className={styles.headerRight}>
          <SkeletonLine width="100px" height="20px" />
          <SkeletonLine width="80px" height="20px" />
        </div>
      </div>

      {/* Main grid skeleton */}
      <div className={styles.gridSkeleton}>
        <PanelSkeleton title="Conditions" />
        <PanelSkeleton title="Sky Quality" />
        <PanelSkeleton title="Radar" />
        <PanelSkeleton title="AllSky" />
      </div>
    </div>
  );
}
