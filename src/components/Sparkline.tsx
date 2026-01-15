"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showMinMax?: boolean;
}

/**
 * Simple sparkline component for showing 24h trends
 * Renders an SVG line chart with optional min/max markers
 */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "#60a5fa",
  showMinMax = false,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className="sparkline">
        <text x={width / 2} y={height / 2 + 3} textAnchor="middle" fill="#444" fontSize="8">
          --
        </text>
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Normalize data to fit in the SVG with some padding
  const padding = 2;
  const chartHeight = height - padding * 2;
  const chartWidth = width - padding * 2;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y, value };
  });

  // Build path
  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");

  // Find min/max positions
  const minPoint = points.reduce((acc, p) => (p.value < acc.value ? p : acc), points[0]);
  const maxPoint = points.reduce((acc, p) => (p.value > acc.value ? p : acc), points[0]);

  return (
    <svg width={width} height={height} className="sparkline">
      {/* Line */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      {/* Current value dot (last point) */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r="2"
        fill={color}
      />
      {/* Min/Max markers if enabled */}
      {showMinMax && minPoint !== maxPoint && (
        <>
          <circle cx={minPoint.x} cy={minPoint.y} r="1.5" fill="#ef4444" opacity="0.6" />
          <circle cx={maxPoint.x} cy={maxPoint.y} r="1.5" fill="#22c55e" opacity="0.6" />
        </>
      )}
    </svg>
  );
}
