"use client";

import { WeatherData, MetricName } from "@/types/weather";
import {
  getCloudIcon,
  getWindIcon,
  getRainIcon,
  getDayIcon,
  getConditionColor,
} from "@/lib/weatherHelpers";
import { WindCompass } from "./WindCompass";
import styles from "./AlertConditions.module.css";

interface AlertConditionsProps {
  data: WeatherData | null;
  onMetricClick?: (metric: MetricName) => void;
}

/**
 * Compact alert conditions widget showing cloud, wind, rain, daylight status and wind compass
 */
export function AlertConditions({ data, onMetricClick }: AlertConditionsProps) {
  const handleClick = (metric: MetricName) => {
    onMetricClick?.(metric);
  };

  return (
    <div className={styles.container}>
      {/* Top row: 4 condition boxes */}
      <div className={styles.conditionsRow}>
        {/* Cloud */}
        <div
          className={styles.conditionItem}
          onClick={() => handleClick("cloud_condition")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.icon}>{getCloudIcon(data?.cloud_condition)}</div>
          <div className={styles.content}>
            <div className={styles.label}>Cloud</div>
            <div
              className={styles.status}
              style={{ color: getConditionColor(data?.cloud_condition, "cloud") }}
            >
              {data?.cloud_condition ?? "--"}
            </div>
          </div>
        </div>

        {/* Wind */}
        <div
          className={styles.conditionItem}
          onClick={() => handleClick("wind_condition")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.icon}>{getWindIcon(data?.wind_condition)}</div>
          <div className={styles.content}>
            <div className={styles.label}>Wind</div>
            <div
              className={styles.status}
              style={{ color: getConditionColor(data?.wind_condition, "wind") }}
            >
              {data?.wind_condition ?? "--"}
            </div>
          </div>
        </div>

        {/* Rain */}
        <div
          className={styles.conditionItem}
          onClick={() => handleClick("rain_condition")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.icon}>{getRainIcon(data?.rain_condition)}</div>
          <div className={styles.content}>
            <div className={styles.label}>Rain</div>
            <div
              className={styles.status}
              style={{ color: getConditionColor(data?.rain_condition, "rain") }}
            >
              {data?.rain_condition ?? "--"}
            </div>
          </div>
        </div>

        {/* Daylight */}
        <div
          className={styles.conditionItem}
          onClick={() => handleClick("day_condition")}
          role="button"
          tabIndex={0}
        >
          <div className={styles.icon}>{getDayIcon(data?.day_condition)}</div>
          <div className={styles.content}>
            <div className={styles.label}>Light</div>
            <div
              className={styles.status}
              style={{ color: getConditionColor(data?.day_condition, "day") }}
            >
              {data?.day_condition ?? "--"}
            </div>
          </div>
        </div>
      </div>

      {/* Compass fills remaining space */}
      <div className={styles.compassWrapper}>
        <WindCompass
          direction={data?.wind_direction ?? null}
          speed={data?.wind_speed ?? null}
          gust={data?.wind_gust ?? null}
        />
      </div>
    </div>
  );
}
