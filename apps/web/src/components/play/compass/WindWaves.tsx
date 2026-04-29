/**
 * Animated wind indicators: 1 to 3 wavy radial lines flowing toward the
 * cadran center. Wave count scales with TWS.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`.
 */

import type { ReactElement } from 'react';

interface WindWavesProps {
  /** True wind direction in degrees (0 = North, 90 = East). */
  twd: number;
  /** True wind speed in knots — controls the number of streams (1 / 2 / 3). */
  tws: number;
  /** Cadran center x coordinate. */
  cx: number;
  /** Cadran center y coordinate. */
  cy: number;
  /** Cadran outer ring radius. */
  r: number;
}

export default function WindWaves({ twd, tws, cx, cy, r }: WindWavesProps): ReactElement {
  const count = tws < 10 ? 1 : tws <= 25 ? 2 : 3;
  const spread = 8; // lateral spacing between parallel streams
  const waves = [];
  for (let i = 0; i < count; i++) {
    // Lateral offset: center stream at 0, others at ±spread
    const dx = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
    // Radial start/end (outside circle, flowing inward)
    const yStart = cy - r - 22;
    const yEnd = cy - r - 4;
    const yMid = (yStart + yEnd) / 2;
    const amp = 3; // wave amplitude
    waves.push(
      <g key={i} transform={`rotate(${twd} ${cx} ${cy})`}>
        {/* Wavy line flowing radially toward center */}
        <path
          d={`M${cx + dx},${yStart} Q${cx + dx + amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx - amp},${yMid + 4} ${cx + dx},${yEnd}`}
          fill="none"
          stroke="#f5f0e8"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <animate
            attributeName="d"
            values={
              `M${cx + dx},${yStart} Q${cx + dx + amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx - amp},${yMid + 4} ${cx + dx},${yEnd};` +
              `M${cx + dx},${yStart} Q${cx + dx - amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx + amp},${yMid + 4} ${cx + dx},${yEnd};` +
              `M${cx + dx},${yStart} Q${cx + dx + amp},${yMid - 4} ${cx + dx},${yMid} Q${cx + dx - amp},${yMid + 4} ${cx + dx},${yEnd}`
            }
            dur={`${1.4 + i * 0.2}s`}
            repeatCount="indefinite"
          />
        </path>
        {/* Arrowhead at the tip, pointing toward center */}
        <path
          d={`M${cx + dx},${yEnd + 5} L${cx + dx - 3},${yEnd - 1} L${cx + dx + 3},${yEnd - 1} Z`}
          fill="#f5f0e8"
        >
          <animate
            attributeName="opacity"
            values="0.8;1;0.8"
            dur={`${1.4 + i * 0.2}s`}
            repeatCount="indefinite"
          />
        </path>
      </g>
    );
  }
  return <g>{waves}</g>;
}
