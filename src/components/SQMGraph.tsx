import { HistoricalReading } from "@/types/weather";
import styles from "./SQMGraph.module.css";

interface SQMGraphProps {
  history: HistoricalReading[];
}

export function SQMGraph({ history }: SQMGraphProps) {
  if (!history.length) {
    return (
      <div className={styles.empty}>
        <p>No historical data available</p>
      </div>
    );
  }

  // Simple SVG line graph
  const width = 300;
  const height = 100;
  const padding = { top: 10, right: 10, bottom: 20, left: 35 };

  const values = history.map((h) => h.sky_quality);
  const minVal = Math.min(...values) - 0.5;
  const maxVal = Math.max(...values) + 0.5;

  const xScale = (i: number) =>
    padding.left +
    (i / (history.length - 1)) * (width - padding.left - padding.right);

  const yScale = (v: number) =>
    height -
    padding.bottom -
    ((v - minVal) / (maxVal - minVal)) * (height - padding.top - padding.bottom);

  const pathD = history
    .map(
      (h, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(h.sky_quality)}`
    )
    .join(" ");

  return (
    <div className={styles.graph}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {[minVal, (minVal + maxVal) / 2, maxVal].map((v, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={yScale(v)}
              x2={width - padding.right}
              y2={yScale(v)}
              stroke="rgba(96, 165, 250, 0.1)"
              strokeDasharray="2,2"
            />
            <text
              x={padding.left - 5}
              y={yScale(v) + 3}
              textAnchor="end"
              fill="#666"
              fontSize="8"
            >
              {v.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Data line */}
        <path
          d={pathD}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {history.map((h, i) => (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(h.sky_quality)}
            r="3"
            fill="#60a5fa"
          />
        ))}

        {/* X-axis labels */}
        {[0, Math.floor(history.length / 2), history.length - 1].map((i) => (
          <text
            key={i}
            x={xScale(i)}
            y={height - 5}
            textAnchor="middle"
            fill="#666"
            fontSize="7"
          >
            {history[i]?.time}
          </text>
        ))}
      </svg>
    </div>
  );
}
