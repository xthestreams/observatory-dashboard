"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showMinMax?: boolean;
  showAxes?: boolean;
  historyHours?: number; // Time window in hours (1, 4, 8, 12, 24, 48)
}

/**
 * Sparkline component for showing trends with optional axes
 * Renders an SVG line chart with time axis and Y-axis (auto-scaled)
 * Time axis labels adapt to the historyHours window
 */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = "#60a5fa",
  showMinMax = false,
  showAxes = false,
  historyHours = 1,
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

  // Layout with optional axes
  const leftPadding = showAxes ? 28 : 2;
  const rightPadding = 2;
  const topPadding = 4;
  const bottomPadding = showAxes ? 14 : 2;

  const chartWidth = width - leftPadding - rightPadding;
  const chartHeight = height - topPadding - bottomPadding;

  const points = data.map((value, index) => {
    const x = leftPadding + (index / (data.length - 1)) * chartWidth;
    const y = topPadding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y, value };
  });

  // Build path
  const pathD = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");

  // Find min/max positions
  const minPoint = points.reduce((acc, p) => (p.value < acc.value ? p : acc), points[0]);
  const maxPoint = points.reduce((acc, p) => (p.value > acc.value ? p : acc), points[0]);

  // Generate Y-axis ticks (3-4 values)
  const generateYTicks = (): { value: number; y: number }[] => {
    const tickCount = 3;
    const ticks: { value: number; y: number }[] = [];

    // Calculate nice round numbers for ticks
    const niceRange = getNiceRange(min, max, tickCount);
    const step = niceRange.step;

    for (let v = niceRange.min; v <= niceRange.max; v += step) {
      const y = topPadding + chartHeight - ((v - min) / range) * chartHeight;
      if (y >= topPadding && y <= topPadding + chartHeight) {
        ticks.push({ value: v, y });
      }
    }
    return ticks;
  };

  // Calculate nice round numbers for axis
  const getNiceRange = (minVal: number, maxVal: number, tickCount: number) => {
    const range = maxVal - minVal || 1;
    const roughStep = range / (tickCount - 1);

    // Find nice step size (1, 2, 5, 10, 20, 50, etc.)
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;

    let niceStep: number;
    if (residual <= 1.5) niceStep = 1 * magnitude;
    else if (residual <= 3) niceStep = 2 * magnitude;
    else if (residual <= 7) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;

    const niceMin = Math.floor(minVal / niceStep) * niceStep;
    const niceMax = Math.ceil(maxVal / niceStep) * niceStep;

    return { min: niceMin, max: niceMax, step: niceStep };
  };

  // Format Y-axis label
  const formatYLabel = (value: number): string => {
    if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(0) + "k";
    }
    if (Math.abs(value) < 10) {
      return value.toFixed(1);
    }
    return Math.round(value).toString();
  };

  // Generate time tick labels based on historyHours
  const generateTimeLabels = () => {
    // For shorter windows, show fewer ticks with appropriate labels
    if (historyHours <= 1) {
      // 1 hour: show -60m, -30m, now
      return [
        { ratio: 0, label: `-${historyHours * 60}m` },
        { ratio: 0.5, label: `-${historyHours * 30}m` },
        { ratio: 1, label: "now" },
      ];
    } else if (historyHours <= 4) {
      // 4 hours: show -4h, -2h, now
      return [
        { ratio: 0, label: `-${historyHours}h` },
        { ratio: 0.5, label: `-${Math.round(historyHours / 2)}h` },
        { ratio: 1, label: "now" },
      ];
    } else if (historyHours <= 12) {
      // 8-12 hours: show 4 ticks
      return [
        { ratio: 0, label: `-${historyHours}h` },
        { ratio: 0.33, label: `-${Math.round(historyHours * 2 / 3)}h` },
        { ratio: 0.67, label: `-${Math.round(historyHours / 3)}h` },
        { ratio: 1, label: "now" },
      ];
    } else {
      // 24-48 hours: show 5 ticks
      return [
        { ratio: 0, label: `-${historyHours}h` },
        { ratio: 0.25, label: `-${Math.round(historyHours * 0.75)}h` },
        { ratio: 0.5, label: `-${Math.round(historyHours / 2)}h` },
        { ratio: 0.75, label: `-${Math.round(historyHours / 4)}h` },
        { ratio: 1, label: "now" },
      ];
    }
  };

  const timeTickPositions = generateTimeLabels().map(tick => ({
    x: leftPadding + tick.ratio * chartWidth,
    label: tick.label
  }));

  const yTicks = showAxes ? generateYTicks() : [];

  return (
    <svg width={width} height={height} className="sparkline">
      {/* Y-axis line and ticks */}
      {showAxes && (
        <>
          {/* Y-axis line */}
          <line
            x1={leftPadding}
            y1={topPadding}
            x2={leftPadding}
            y2={topPadding + chartHeight}
            stroke="#444"
            strokeWidth="0.5"
          />
          {/* Y-axis ticks and labels */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={leftPadding - 3}
                y1={tick.y}
                x2={leftPadding}
                y2={tick.y}
                stroke="#444"
                strokeWidth="0.5"
              />
              <text
                x={leftPadding - 5}
                y={tick.y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#666"
                fontSize="7"
              >
                {formatYLabel(tick.value)}
              </text>
              {/* Horizontal grid line */}
              <line
                x1={leftPadding}
                y1={tick.y}
                x2={leftPadding + chartWidth}
                y2={tick.y}
                stroke="#333"
                strokeWidth="0.5"
                strokeDasharray="2,2"
                opacity="0.5"
              />
            </g>
          ))}
        </>
      )}

      {/* X-axis line and ticks */}
      {showAxes && (
        <>
          {/* X-axis line */}
          <line
            x1={leftPadding}
            y1={topPadding + chartHeight}
            x2={leftPadding + chartWidth}
            y2={topPadding + chartHeight}
            stroke="#444"
            strokeWidth="0.5"
          />
          {/* Time ticks */}
          {timeTickPositions.map((tick, i) => (
            <g key={i}>
              <line
                x1={tick.x}
                y1={topPadding + chartHeight}
                x2={tick.x}
                y2={topPadding + chartHeight + 3}
                stroke="#444"
                strokeWidth="0.5"
              />
              <text
                x={tick.x}
                y={topPadding + chartHeight + 10}
                textAnchor="middle"
                fill="#666"
                fontSize="6"
              >
                {tick.label}
              </text>
            </g>
          ))}
        </>
      )}

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
