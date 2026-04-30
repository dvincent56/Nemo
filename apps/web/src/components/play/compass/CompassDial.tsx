/**
 * Compass cadran — the SVG dial only. Pure, prop-driven, no store.
 *
 * Owns: double-bezel layout (navy outer ring + ivory inner ring + ivory dial),
 * tick marks (gold on bezel, navy on dial edge), degree labels & cardinals
 * placed on the ivory ring, North compass-rose star, optional wind waves,
 * optional IMOCA boat silhouette + cap line + arrow tip with idle pulse,
 * draggable affordance arcs (visible on hover), ghost rendering,
 * drag-to-rotate, wheel-to-rotate, 60Hz preview via direct SVG transform
 * mutation.
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
  R_BEZEL_OUTER,
  R_BEZEL_INNER,
  R_DIAL,
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

/** Polar → cartesian for in-component tick/label generation. */
function pol(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

const CARDINALS: { label: string; deg: number }[] = [
  { label: 'N', deg: 0 },
  { label: 'E', deg: 90 },
  { label: 'S', deg: 180 },
  { label: 'O', deg: 270 },
];

const NUMBER_DEGREES = [30, 60, 120, 150, 210, 240, 300, 330];

/** Radius at which cardinals (N/E/S/O) sit on the ivory ring. */
const R_CARDINAL_LABEL = 86;
/** Radius at which 030..330 numbers sit on the ivory ring (slightly inboard). */
const R_DEGREE_LABEL = 84;

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

  // valueRef lets the wheel handler read the latest committed value without
  // re-attaching listeners on every value change. Without this, the effect
  // would tear down and rebuild listeners 30-60 times per second during a
  // fast drag, and rapid wheel events in the same frame would under-count
  // because they'd all read the same stale closure value.
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  // 60Hz preview — write the boat / ghost transform attributes directly,
  // bypassing React's reconciler. The committed React `value` prop catches
  // up on pointer-up (parent calls onChange).
  const writeSvg = useCallback((target: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');
    if (boat) boat.setAttribute('transform', `rotate(${target} ${CX} ${CY})`);
    if (ghost) ghost.style.opacity = ghostValue === undefined || target === ghostValue ? '0' : '0.3';
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
      ghost.style.opacity = ghostValue === undefined || value === ghostValue ? '0' : '0.3';
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
      const next = (valueRef.current + delta + 360) % 360;
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
  }, [readOnly, onChange, getHdgFromEvent, writeSvg]);

  // ── Bezel ticks (radial lines etched through the navy bezel) ──
  // Cardinals span the full bezel width (gold), intercardinals (30°) span
  // ~70% (gold), minor 10° ticks span ~30% (ivory pale). Generated once
  // on render — the bezel itself never rotates.
  const bezelTicks: ReactElement[] = [];
  for (let deg = 0; deg < 360; deg += 10) {
    const isCardinal = deg % 90 === 0;
    const isInter = deg % 30 === 0 && !isCardinal;
    const bandWidth = R_BEZEL_OUTER - R_BEZEL_INNER;
    const len = isCardinal ? bandWidth : isInter ? bandWidth * 0.7 : bandWidth * 0.35;
    const a = pol(R_BEZEL_INNER, deg);
    const b = pol(R_BEZEL_INNER + len, deg);
    const stroke = (isCardinal || isInter) ? '#c9a227' : 'rgba(245,240,232,0.55)';
    const w = isCardinal ? 1.6 : isInter ? 1.0 : 0.5;
    const op = isCardinal ? 0.95 : isInter ? 0.78 : 0.6;
    bezelTicks.push(
      <line key={`bezel-${deg}`}
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={stroke} strokeWidth={w} opacity={op} />,
    );
  }

  // ── Inner dial ticks (subtle navy ink at the very edge of the ivory dial) ──
  // Adds tactile texture inside the dial without competing with boat / cap line.
  const dialEdgeTicks: ReactElement[] = [];
  for (let deg = 0; deg < 360; deg += 10) {
    const isCardinal = deg % 90 === 0;
    const isInter = deg % 30 === 0 && !isCardinal;
    const len = isCardinal ? 6 : isInter ? 4 : 2;
    const a = pol(R_DIAL - 2, deg);
    const b = pol(R_DIAL - 2 - len, deg);
    const op = isCardinal ? 0.55 : isInter ? 0.32 : 0.18;
    dialEdgeTicks.push(
      <line key={`edge-${deg}`}
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="#1a2840" strokeWidth={isCardinal ? 1 : 0.5} opacity={op} />,
    );
  }

  return (
    <div className={styles.stage}>
      <svg ref={svgRef} viewBox={`0 0 ${VB} ${VB}`} className={styles.svg}>
        <defs>
          {/* Ivory dial gradient — paper-warm at edges for a subtle vignette */}
          <radialGradient id="cd-dial-gradient" cx="50%" cy="48%" r="55%">
            <stop offset="0%" stopColor="#fbf7f0" />
            <stop offset="80%" stopColor="#f3eadb" />
            <stop offset="100%" stopColor="#e8dcc6" />
          </radialGradient>
          {/* Navy bezel gradient — slightly lighter at centre for depth */}
          <radialGradient id="cd-bezel-gradient" cx="50%" cy="50%" r="55%">
            <stop offset="60%" stopColor="#243552" />
            <stop offset="100%" stopColor="#0c1424" />
          </radialGradient>
        </defs>

        {/* 1. Navy bezel disc (filled to outer radius) */}
        <circle cx={CX} cy={CY} r={R_BEZEL_OUTER} fill="url(#cd-bezel-gradient)" />
        {/* Outer hairline gold rim */}
        <circle cx={CX} cy={CY} r={R_BEZEL_OUTER} fill="none"
          stroke="#a8871e" strokeWidth={1} opacity={0.7} />

        {/* 2. Ivory ring (covers the inner part of the bezel disc, leaves
              a navy band visible from R_BEZEL_INNER to R_BEZEL_OUTER) */}
        <circle cx={CX} cy={CY} r={R_BEZEL_INNER} fill="#f3eadb" />
        <circle cx={CX} cy={CY} r={R_BEZEL_INNER} fill="none"
          stroke="#c9a227" strokeWidth={0.8} opacity={0.7} />

        {/* 3. Inner ivory dial (slightly different ivory tone for a layered look) */}
        <circle cx={CX} cy={CY} r={R_DIAL} fill="url(#cd-dial-gradient)" />
        <circle cx={CX} cy={CY} r={R_DIAL} fill="none"
          stroke="#c9a227" strokeWidth={1.2} opacity={0.85} />

        {/* 4. Bezel ticks (gold on navy) */}
        {bezelTicks}

        {/* 5. Degree labels (030, 060…) on the ivory ring, navy mono */}
        {NUMBER_DEGREES.map((deg) => {
          const p = pol(R_DEGREE_LABEL, deg);
          return (
            <text key={`deg-${deg}`} x={p.x} y={p.y} className={styles.degreeLabel}
              fontFamily="Space Mono,monospace" fontSize="8" fontWeight="700"
              fill="rgba(26,40,64,0.78)"
              textAnchor="middle" dominantBaseline="central">
              {String(deg).padStart(3, '0')}
            </text>
          );
        })}

        {/* 6. Cardinal labels on the ivory ring, navy display, larger */}
        {CARDINALS.map(({ label, deg }) => {
          const p = pol(R_CARDINAL_LABEL, deg);
          return (
            <text key={label} x={p.x} y={p.y} className={styles.cardinalLabel}
              fontFamily="Bebas Neue,sans-serif" fontSize="14"
              fill="#1a2840"
              textAnchor="middle" dominantBaseline="central">{label}</text>
          );
        })}

        {/* 7. Inner dial edge ticks (subtle navy ink) */}
        {dialEdgeTicks}

        {/* 8. Wind waves (overlay outside the bezel, ivory strokes for visibility on navy panel) */}
        {showWindWaves && <WindWaves twd={windDir} tws={tws} cx={CX} cy={CY} r={R_BEZEL_OUTER} />}

        {/* 9. Ghost silhouette (visible during heading edit, dashed navy on ivory) */}
        <g id="ghost" transform={`rotate(${ghostValue ?? value} ${CX} ${CY})`}
          style={{ opacity: ghostValue === undefined || value === ghostValue ? 0 : 0.3 }}>
          <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
            <path d={IMOCA_PATH}
              fill="none" stroke="#1a2840" strokeWidth={10} strokeDasharray="14 9" />
          </g>
        </g>

        {/* 10. Boat group — IMOCA + cap line + arrow tip + drag arcs (rotates with heading) */}
        {showBoat && (
          <g id="boat" transform={`rotate(${value} ${CX} ${CY})`}>
            {/* Drag-affordance arcs — hidden by default, fade in on stage:hover.
                Trace the dial's own rim (radius 68) on either side of the cap
                arrow rather than curving outward, so they read as "rotate
                around the centre" instead of two unrelated little curls. */}
            <g className={styles.dragArc} stroke="#e2bf3e" strokeWidth={1.6}
              fill="none" strokeLinecap="round">
              {/* Left arc: counter-clockwise, from 5° to 15° left of cap */}
              <path d={`M ${CX - 5.9} ${CY - 67.7} A 68 68 0 0 0 ${CX - 17.6} ${CY - 65.7}`} />
              <polygon points={`${CX - 20},${CY - 65} ${CX - 18},${CY - 68} ${CX - 17},${CY - 64}`}
                fill="#e2bf3e" stroke="none" />
              {/* Right arc: clockwise mirror */}
              <path d={`M ${CX + 5.9} ${CY - 67.7} A 68 68 0 0 1 ${CX + 17.6} ${CY - 65.7}`} />
              <polygon points={`${CX + 20},${CY - 65} ${CX + 17},${CY - 64} ${CX + 18},${CY - 68}`}
                fill="#e2bf3e" stroke="none" />
            </g>

            {/* Cap line — solid gold, idle-pulses opacity */}
            <line className={styles.capLine}
              x1={CX} y1={CY - 24} x2={CX} y2={CY - 64}
              stroke="#c9a227" strokeWidth={3} strokeLinecap="round" />

            {/* Cap arrow tip — idle-pulses scale around its centroid */}
            <polygon className={styles.capTip}
              points={`${CX},${CY - 72} ${CX - 6},${CY - 60} ${CX + 6},${CY - 60}`}
              fill="#c9a227" />

            {/* IMOCA silhouette — navy fill on ivory dial */}
            <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
              <path d={IMOCA_PATH} fill="#1a2840" />
            </g>
          </g>
        )}

        {/* 11. Centre pin */}
        <circle cx={CX} cy={CY} r={2.5} fill="#1a2840" opacity={0.55} />
      </svg>
    </div>
  );
}
