"use client";

import { Announcement } from "@/types/client";
import styles from "./MessageOfTheDay.module.css";

interface MessageOfTheDayProps {
  announcement: Announcement | null;
  clientName: string;
}

export function MessageOfTheDay({
  announcement,
  clientName,
}: MessageOfTheDayProps) {
  if (!announcement) return null;

  // Determine icon and background based on type
  const typeConfig: Record<
    string,
    { icon: string; bgColor: string; textColor: string }
  > = {
    info: {
      icon: "ℹ️",
      bgColor: "#e3f2fd",
      textColor: "#1976d2",
    },
    warning: {
      icon: "⚠️",
      bgColor: "#fff3e0",
      textColor: "#f57c00",
    },
    outage: {
      icon: "🚨",
      bgColor: "#ffebee",
      textColor: "#d32f2f",
    },
    maintenance: {
      icon: "🔧",
      bgColor: "#f3e5f5",
      textColor: "#7b1fa2",
    },
    alert: {
      icon: "🔔",
      bgColor: "#ffe0b2",
      textColor: "#e65100",
    },
  };

  const config = typeConfig[announcement.type] || typeConfig.info;

  return (
    <div
      className={styles.container}
      style={{
        backgroundColor: config.bgColor,
        borderLeftColor: config.textColor,
      }}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.icon}>{config.icon}</span>
          <h2 className={styles.title} style={{ color: config.textColor }}>
            {announcement.title}
          </h2>
        </div>
        <div className={styles.meta}>
          <span className={styles.type} style={{ color: config.textColor }}>
            {announcement.type.toUpperCase()}
          </span>
          <span className={styles.date}>
            {new Date(announcement.published_at).toLocaleDateString()} at{" "}
            {new Date(announcement.published_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      <div
        className={styles.content}
        dangerouslySetInnerHTML={{ __html: announcement.content }}
      />

      {announcement.expires_at && (
        <div className={styles.expiresAt}>
          Expires: {new Date(announcement.expires_at).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
