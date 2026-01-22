"use client";

import { ObservatoryCamera } from "@/types/client";
import { useState } from "react";
import styles from "./CameraFeed.module.css";

interface CameraFeedProps {
  cameras: ObservatoryCamera[];
  clientSlug: string;
}

export function CameraFeed({ cameras, clientSlug }: CameraFeedProps) {
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(
    cameras[0]?.id || null
  );

  if (!cameras || cameras.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No cameras available</p>
      </div>
    );
  }

  const selectedCamera = cameras.find((c) => c.id === selectedCameraId);

  return (
    <div className={styles.container}>
      <div className={styles.viewer}>
        {selectedCamera && (
          <>
            <div className={styles.imageContainer}>
              {selectedCamera.image_source_type === "local_file" ? (
                <img
                  src={`/api/camera/${clientSlug}/${selectedCamera.id}`}
                  alt={selectedCamera.name}
                  className={styles.image}
                />
              ) : selectedCamera.image_source_type === "http_url" ? (
                <img
                  src={selectedCamera.image_source_path}
                  alt={selectedCamera.name}
                  className={styles.image}
                />
              ) : (
                <div className={styles.placeholder}>
                  MQTT camera stream not yet configured
                </div>
              )}
            </div>
            <div className={styles.info}>
              <h3 className={styles.name}>{selectedCamera.name}</h3>
              {selectedCamera.location && (
                <p className={styles.location}>{selectedCamera.location}</p>
              )}
              {selectedCamera.last_update && (
                <p className={styles.timestamp}>
                  Last updated:{" "}
                  {new Date(selectedCamera.last_update).toLocaleTimeString()}
                </p>
              )}
              {selectedCamera.description && (
                <p className={styles.description}>
                  {selectedCamera.description}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {cameras.length > 1 && (
        <div className={styles.thumbnails}>
          {cameras.map((camera) => (
            <button
              key={camera.id}
              className={`${styles.thumbnail} ${
                selectedCameraId === camera.id ? styles.active : ""
              }`}
              onClick={() => setSelectedCameraId(camera.id)}
              title={camera.name}
            >
              <span className={styles.label}>{camera.name}</span>
              {camera.is_featured && (
                <span className={styles.featured}>★</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
