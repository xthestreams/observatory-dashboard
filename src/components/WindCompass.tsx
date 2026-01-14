import styles from "./WindCompass.module.css";

interface WindCompassProps {
  direction: number | null;  // Wind direction in degrees (0-360, 0 = North)
  speed?: number | null;     // Optional wind speed to display
  gust?: number | null;      // Optional gust speed to display
}

export function WindCompass({ direction, speed, gust }: WindCompassProps) {
  const hasDirection = direction !== null && !isNaN(direction);

  // Cardinal directions
  const cardinals = [
    { label: "N", angle: 0 },
    { label: "E", angle: 90 },
    { label: "S", angle: 180 },
    { label: "W", angle: 270 },
  ];

  // Intercardinal tick marks (NE, SE, SW, NW)
  const intercardinals = [45, 135, 225, 315];

  return (
    <div className={styles.container}>
      <svg viewBox="0 0 100 100" className={styles.compass}>
        {/* Outer circle */}
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke="rgba(96, 165, 250, 0.2)"
          strokeWidth="1"
        />

        {/* Inner circle */}
        <circle
          cx="50"
          cy="50"
          r="32"
          fill="none"
          stroke="rgba(96, 165, 250, 0.1)"
          strokeWidth="1"
        />

        {/* Cardinal direction labels */}
        {cardinals.map(({ label, angle }) => {
          const rad = (angle - 90) * (Math.PI / 180);
          const x = 50 + 40 * Math.cos(rad);
          const y = 50 + 40 * Math.sin(rad);
          return (
            <text
              key={label}
              x={x}
              y={y}
              className={styles.cardinal}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {label}
            </text>
          );
        })}

        {/* Intercardinal tick marks */}
        {intercardinals.map((angle) => {
          const rad = (angle - 90) * (Math.PI / 180);
          const x1 = 50 + 43 * Math.cos(rad);
          const y1 = 50 + 43 * Math.sin(rad);
          const x2 = 50 + 46 * Math.cos(rad);
          const y2 = 50 + 46 * Math.sin(rad);
          return (
            <line
              key={angle}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(96, 165, 250, 0.3)"
              strokeWidth="1"
            />
          );
        })}

        {/* Wind direction arrow */}
        {hasDirection && (
          <g
            transform={`rotate(${direction}, 50, 50)`}
            className={styles.arrow}
          >
            {/* Arrow body */}
            <line
              x1="50"
              y1="50"
              x2="50"
              y2="18"
              stroke="#60a5fa"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            {/* Arrow head */}
            <polygon
              points="50,12 45,22 55,22"
              fill="#60a5fa"
            />
            {/* Arrow tail (small circle at center) */}
            <circle
              cx="50"
              cy="50"
              r="4"
              fill="#60a5fa"
            />
          </g>
        )}

        {/* No data indicator */}
        {!hasDirection && (
          <text
            x="50"
            y="50"
            className={styles.noData}
            textAnchor="middle"
            dominantBaseline="central"
          >
            --
          </text>
        )}
      </svg>

      {/* Speed display below compass */}
      <div className={styles.speedDisplay}>
        {speed !== null && speed !== undefined ? (
          <>
            <span className={styles.speedValue}>{speed.toFixed(1)}</span>
            <span className={styles.speedUnit}>km/h</span>
            {gust !== null && gust !== undefined && gust > speed && (
              <span className={styles.gustValue}>
                (gust {gust.toFixed(0)})
              </span>
            )}
          </>
        ) : (
          <span className={styles.noSpeed}>No wind data</span>
        )}
      </div>

      {/* Direction label */}
      {hasDirection && (
        <div className={styles.directionLabel}>
          {getDirectionLabel(direction)}° ({getCardinalDirection(direction)})
        </div>
      )}
    </div>
  );
}

/**
 * Get cardinal/intercardinal direction label from degrees
 */
function getCardinalDirection(degrees: number): string {
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                      "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(degrees / 22.5) % 16;
  return directions[index];
}

/**
 * Format direction as 3-digit degrees
 */
function getDirectionLabel(degrees: number): string {
  return Math.round(degrees).toString().padStart(3, "0");
}
