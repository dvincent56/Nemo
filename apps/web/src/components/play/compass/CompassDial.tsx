/**
 * Compass cadran — the SVG dial only. Pure, prop-driven, no store.
 *
 * Owns: ticks, cardinals, degree labels, optional wind waves, optional
 * IMOCA boat silhouette, ghost rendering, drag-to-rotate, wheel-to-rotate,
 * 60Hz preview via direct SVG transform mutation.
 *
 * Does NOT own: readouts, lock toggle, Valider/Cancel actions, VMG glow
 * (consumer applies it as a wrapper class), polar awareness, manoeuvre hints.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`.
 */

'use client';

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import {
  VB,
  CX,
  CY,
  R_OUTER,
  R_INNER,
  IMOCA_PATH,
  IMOCA_SCALE,
  IMOCA_VB,
} from './compassGeometry';
import WindWaves from './WindWaves';
import styles from './CompassDial.module.css';

export interface CompassDialProps {
  /** Heading rendered as the boat orientation (0..359). */
  value: number;
  /** Called during drag and wheel. Omit to make the dial read-only. */
  onChange?: (nextDeg: number) => void;
  /** True wind direction in degrees — drives the wave overlay. */
  windDir: number;
  /**
   * Heading of the ghost silhouette. When undefined or === value, the ghost
   * is rendered at value with opacity 0 (effectively invisible). When
   * different from value, the ghost renders at ghostValue at low opacity
   * (visual "before vs. after" preview during drag).
   */
  ghostValue?: number;
  /** True wind speed in knots — controls wind waves stream count (default 1). */
  tws?: number;
  /** Render the IMOCA silhouette (default true). */
  showBoat?: boolean;
  /** Render the animated wind waves outside the cadran (default true). */
  showWindWaves?: boolean;
  /** Disable drag / wheel handlers (default false). */
  readOnly?: boolean;
}

export default function CompassDial({
  value,
  onChange,
  windDir,
  ghostValue,
  tws = 1,
  showBoat = true,
  showWindWaves = true,
  readOnly = false,
}: CompassDialProps): ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);

  // 60Hz preview — write the boat / ghost transform attributes directly,
  // bypassing React's reconciler. The committed React `value` prop catches
  // up on pointer-up (parent calls onChange).
  const writeSvg = useCallback((target: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');
    if (boat) boat.setAttribute('transform', `rotate(${target} ${CX} ${CY})`);
    if (ghost) ghost.style.opacity = ghostValue === undefined || target === ghostValue ? '0' : '0.2';
  }, [ghostValue]);

  // Sync SVG when value or ghostValue change from parent state (e.g., server tick).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');
    if (boat) boat.setAttribute('transform', `rotate(${value} ${CX} ${CY})`);
    if (ghost) {
      ghost.setAttribute('transform', `rotate(${ghostValue ?? value} ${CX} ${CY})`);
      ghost.style.opacity = ghostValue === undefined || value === ghostValue ? '0' : '0.2';
    }
  }, [value, ghostValue]);

  // Drag handling — pointer→heading angle math. Returns null inside the
  // dead-zone near the centre where small mouse movements would translate
  // to large angle jumps.
  const getHdgFromEvent = useCallback((e: PointerEvent): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (dx * dx + dy * dy < 400) return null; // dead zone in center
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    return Math.round(angle) % 360;
  }, []);

  useEffect(() => {
    if (readOnly || !onChange) return;
    const svg = svgRef.current;
    if (!svg) return;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      const h = getHdgFromEvent(e);
      if (h !== null) {
        writeSvg(h);
        onChange(h);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const h = getHdgFromEvent(e);
      if (h !== null) {
        writeSvg(h);
        onChange(h);
      }
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      svg.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? -1 : 1;
      const next = (value + delta + 360) % 360;
      writeSvg(next);
      onChange(next);
    };

    svg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      svg.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      svg.removeEventListener('wheel', onWheel);
    };
  }, [readOnly, onChange, getHdgFromEvent, writeSvg, value]);

  // Tick generation
  const ticks: ReactElement[] = [];
  for (let i = 0; i < 36; i++) {
    const deg = i * 10;
    const isCardinal = deg % 90 === 0;
    const isIntercardinal = deg % 45 === 0 && !isCardinal;
    const len = isCardinal ? 12 : isIntercardinal ? 10 : 6;
    const opacity = isCardinal ? 0.4 : isIntercardinal ? 0.25 : 0.15;
    const width = isCardinal ? 1.2 : 0.5;
    const rad = ((deg - 90) * Math.PI) / 180;
    const x1 = CX + R_OUTER * Math.cos(rad);
    const y1 = CY + R_OUTER * Math.sin(rad);
    const x2 = CX + (R_OUTER - len) * Math.cos(rad);
    const y2 = CY + (R_OUTER - len) * Math.sin(rad);
    ticks.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={`rgba(245,240,232,${opacity})`} strokeWidth={width} />
    );
  }

  const cardinals: { label: string; deg: number }[] = [
    { label: 'N', deg: 0 }, { label: 'E', deg: 90 },
    { label: 'S', deg: 180 }, { label: 'O', deg: 270 },
  ];

  return (
    <div className={styles.stage}>
      <svg ref={svgRef} viewBox={`0 0 ${VB} ${VB}`} className={styles.svg}>
        <circle cx={CX} cy={CY} r={R_OUTER} fill="none"
          stroke="rgba(245,240,232,0.18)" strokeWidth="1" />
        <circle cx={CX} cy={CY} r={R_INNER} fill="none"
          stroke="rgba(245,240,232,0.08)" strokeWidth="0.5" />

        {ticks}

        {cardinals.map(({ label, deg }) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const x = CX + (R_OUTER - 20) * Math.cos(rad);
          const y = CY + (R_OUTER - 20) * Math.sin(rad);
          return (
            <text key={label} x={x} y={y} className={styles.cardinalLabel}
              fontFamily="Bebas Neue,sans-serif" fontSize="15"
              fill="rgba(245,240,232,0.85)"
              textAnchor="middle" dominantBaseline="central">{label}</text>
          );
        })}

        {[30, 60, 120, 150, 210, 240, 300, 330].map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const x = CX + (R_OUTER - 32) * Math.cos(rad);
          const y = CY + (R_OUTER - 32) * Math.sin(rad);
          return (
            <text key={`deg-${deg}`} x={x} y={y} className={styles.degreeLabel}
              fontFamily="Space Mono,monospace" fontSize="8" fontWeight="700"
              fill="rgba(245,240,232,0.35)"
              textAnchor="middle" dominantBaseline="central">
              {String(deg).padStart(3, '0')}
            </text>
          );
        })}

        {showWindWaves && <WindWaves twd={windDir} tws={tws} cx={CX} cy={CY} r={R_OUTER} />}

        <g id="ghost" transform={`rotate(${ghostValue ?? value} ${CX} ${CY})`}
          style={{ opacity: ghostValue === undefined || value === ghostValue ? 0 : 0.2 }}>
          <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
            <path d={IMOCA_PATH}
              fill="none" stroke="#f5f0e8" strokeWidth={8} strokeDasharray="12 8" />
          </g>
        </g>

        {showBoat && (
          <g id="boat" transform={`rotate(${value} ${CX} ${CY})`}>
            <line x1={CX} y1={CY - 26} x2={CX} y2={CY - 70}
              stroke="#f5f0e8" strokeWidth="1" opacity="0.5" strokeDasharray="4 3" />
            <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
              <path d={IMOCA_PATH} fill="#c9a227" />
            </g>
          </g>
        )}

        <circle cx={CX} cy={CY} r={3} fill="rgba(245,240,232,0.25)" />
      </svg>
    </div>
  );
}
