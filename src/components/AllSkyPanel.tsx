"use client";

import { useEffect, useRef, useCallback } from "react";
import styles from "./AllSkyPanel.module.css";

interface AllSkyPanelProps {
  imageUrl: string;
  onNewImage?: () => void;
  pollInterval?: number; // ms between status checks, default 30s
}

export default function AllSkyPanel({
  imageUrl,
  onNewImage,
  pollInterval = 30000, // Increased from 10s to 30s to reduce requests
}: AllSkyPanelProps) {
  const lastUploadRef = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleClick = () => {
    window.open("/allsky", "_blank", "noopener,noreferrer");
  };

  // Poll for new images
  const checkForNewImage = useCallback(async () => {
    try {
      const res = await fetch("/api/allsky/status");
      if (!res.ok) return;

      const data = await res.json();
      const newUpload = data.lastUpload;

      if (newUpload && lastUploadRef.current && newUpload !== lastUploadRef.current) {
        // New image detected!
        lastUploadRef.current = newUpload;

        // Use the actual upload timestamp for cache key instead of Date.now()
        // This allows proper caching - URL only changes when there's a real new image
        if (imgRef.current) {
          const baseUrl = imageUrl.split("?")[0];
          // Use upload timestamp as version key - cacheable until next upload
          imgRef.current.src = `${baseUrl}?v=${encodeURIComponent(newUpload)}`;
        }

        // Notify parent to refresh dashboard data
        onNewImage?.();
      } else if (newUpload && !lastUploadRef.current) {
        // First poll - store timestamp and set initial image URL with version
        lastUploadRef.current = newUpload;
        if (imgRef.current) {
          const baseUrl = imageUrl.split("?")[0];
          imgRef.current.src = `${baseUrl}?v=${encodeURIComponent(newUpload)}`;
        }
      }
    } catch (err) {
      // Silent fail - polling will retry
    }
  }, [imageUrl, onNewImage]);

  useEffect(() => {
    // Initial check
    checkForNewImage();

    // Set up polling
    const interval = setInterval(checkForNewImage, pollInterval);
    return () => clearInterval(interval);
  }, [checkForNewImage, pollInterval]);

  return (
    <div className={styles.container}>
      <div
        className={styles.imageWrapper}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleClick();
          }
        }}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt="All-sky view"
          className={styles.image}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <div className={styles.clickHint}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span>Click to view with star overlay</span>
        </div>
      </div>
    </div>
  );
}
