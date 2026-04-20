'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SailId } from '@nemo/shared-types';
import { sendOrder, useGameStore } from '@/lib/store';
import { getCachedPolar, getPolarSpeed } from '@/lib/polar';
import { Lock, LockOpen, Check } from 'lucide-react';
import styles from './Compass.module.css';
import Tooltip from '@/components/ui/Tooltip';

/* ── Constants ────────────────────────────────────── */
const VB = 220; // viewBox size

/**
 * IMOCA silhouette path — original viewBox 0 0 603 180, evenodd fill.
 * Rendered via a <g> with transform to scale/rotate/center it.
 * Boat points RIGHT in original coords → rotate(-90) to point UP.
 */
const IMOCA_VB = { w: 611, h: 188 };
const IMOCA_PATH = 'M89.62 0.00 L84.78 0.93 L68.78 0.94 L32.11 3.00 L18.73 3.26 L0.00 80.71 L0.00 103.30 L2.80 111.69 L14.24 153.84 L17.40 166.90 L18.32 175.45 L25.85 176.86 L51.53 178.03 L60.95 178.02 L73.13 179.02 L97.07 179.19 L98.62 179.34 L99.65 180.00 L210.37 180.00 L215.52 179.04 L233.38 179.06 L243.05 178.12 L264.43 177.00 L271.73 177.04 L283.24 175.39 L299.16 174.28 L302.12 174.51 L336.55 171.65 L382.22 166.14 L417.19 160.27 L444.90 154.36 L472.32 147.28 L499.36 138.92 L525.97 129.17 L553.80 117.15 L588.07 99.45 L603.00 89.93 L603.00 92.93 L603.00 89.26 L600.20 87.99 L577.71 74.58 L549.21 60.42 L520.01 48.24 L494.37 39.23 L468.48 31.48 L442.36 24.91 L407.19 17.75 L371.69 12.20 L326.93 7.11 L272.77 3.02 L236.84 0.99 L223.36 0.89 L219.33 0.00 L89.62 0.00 Z';
/** Scale factor to fit IMOCA (~50px tall) in compass */
const IMOCA_SCALE = 50 / IMOCA_VB.w;
const CX = VB / 2;
const CY = VB / 2;
const R_OUTER = 96;
const R_INNER = 82;

const SAIL_RANGES: Record<string, [number, number]> = {
  JIB: [30, 100], LJ: [0, 70], SS: [0, 60],
  C0: [60, 150], SPI: [80, 180], HG: [100, 180], LG: [80, 170],
};

function pt(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: Math.round((CX + r * Math.cos(rad)) * 100) / 100,
    y: Math.round((CY + r * Math.sin(rad)) * 100) / 100,
  };
}

/** Check if current TWA is in VMG optimal zone */
function isInVmgZone(twa: number): boolean {
  const a = Math.abs(twa);
  return (a >= 38 && a <= 54) || (a >= 140 && a <= 162);
}

/** Determine which sail would be selected for a given TWA in auto mode */
function bestSailForTwa(absT: number): string | null {
  const order = ['SPI', 'HG', 'LG', 'C0', 'JIB', 'LJ', 'SS'];
  for (const s of order) {
    const range = SAIL_RANGES[s];
    if (range && absT >= range[0] && absT <= range[1]) return s;
  }
  return null;
}

/** Animated wind indicators — wavy radial lines flowing toward compass center */
function WindWaves({ twd, tws, cx, cy, r }: { twd: number; tws: number; cx: number; cy: number; r: number }): React.ReactElement {
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

export default function Compass(): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const [targetHdg, setTargetHdg] = useState<number | null>(null);
  const [twaLocked, setTwaLocked] = useState(false);
  const [lockedTwa, setLockedTwa] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [pendingSailChange, setPendingSailChange] = useState<string | null>(null);

  // Store subscriptions
  const hdg = useGameStore((s) => s.hud.hdg);
  const twd = useGameStore((s) => s.hud.twd);
  const tws = useGameStore((s) => s.hud.tws);
  const bsp = useGameStore((s) => s.hud.bsp);
  const twa = useGameStore((s) => s.hud.twa);
  const boatClass = useGameStore((s) => s.hud.boatClass);
  const currentSail = useGameStore((s) => s.sail.currentSail);
  const sailAuto = useGameStore((s) => s.sail.sailAuto);

  // Displayed values — live update during drag
  const applyActive = targetHdg !== null && targetHdg !== hdg;
  const displayHdg = targetHdg ?? hdg;
  const displayTwa = ((displayHdg - twd + 540) % 360) - 180;
  const vmgGlow = isInVmgZone(displayTwa);

  // Estimated BSP from polars — only during heading edit
  const polar = getCachedPolar(boatClass);
  const displayBsp = applyActive && polar
    ? getPolarSpeed(polar, currentSail, displayTwa, tws)
    : bsp;

  // BSP efficiency color: compare to max polar speed at current TWS
  const maxPolarBsp = polar
    ? Math.max(...polar.twa.map((a) => {
        let best = 0;
        for (const s of Object.keys(polar.speeds)) {
          const v = getPolarSpeed(polar, s as SailId, a, tws);
          if (v > best) best = v;
        }
        return best;
      }))
    : 0;
  const bspRatio = maxPolarBsp > 0 ? displayBsp / maxPolarBsp : 1;
  const bspColor = bspRatio >= 0.85 ? styles.live     // vert — efficace
    : bspRatio >= 0.6 ? styles.warn                    // orange — moyen
    : styles.danger;                                   // rouge — inefficace

  // Check sail change implication when editing.
  // Only surfaces a notification when the player is previewing a *different*
  // heading than the current one — no-op for incidental taps on the compass.
  const checkSailChange = useCallback((newHdg: number) => {
    if (!sailAuto || newHdg === hdg) { setPendingSailChange(null); return; }
    const newTwa = Math.abs(((newHdg - twd + 540) % 360) - 180);
    const newBest = bestSailForTwa(newTwa);
    if (newBest && newBest !== currentSail) {
      setPendingSailChange(`${currentSail} → ${newBest}`);
    } else {
      setPendingSailChange(null);
    }
  }, [sailAuto, twd, currentSail, hdg]);

  // ── SVG direct DOM update (60fps during drag) ──
  const writeSvg = useCallback((target: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');

    if (boat) boat.setAttribute('transform', `rotate(${target} ${CX} ${CY})`);
    if (ghost) ghost.style.opacity = target === hdg ? '0' : '0.2';
  }, [hdg]);

  // Sync SVG when hdg/twd changes from server
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');

    if (boat && targetHdg === null) {
      boat.setAttribute('transform', `rotate(${hdg} ${CX} ${CY})`);
    }
    if (ghost) {
      ghost.setAttribute('transform', `rotate(${hdg} ${CX} ${CY})`);
      ghost.style.opacity = '0';
    }
  }, [hdg, twd]);

  // TWA lock: adjust heading when wind shifts
  useEffect(() => {
    if (twaLocked) {
      const newHdg = ((twd + lockedTwa) + 360) % 360;
      useGameStore.getState().setHud({ hdg: Math.round(newHdg) });
    }
  }, [twaLocked, lockedTwa, twd]);

  // ── Drag handling ──
  const getHdgFromEvent = (e: PointerEvent): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (dx * dx + dy * dy < 400) return null; // too close to center
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    return Math.round(angle) % 360;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let dragging = false;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      const h = getHdgFromEvent(e);
      if (h !== null) {
        setTargetHdg(h);
        writeSvg(h);
        checkSailChange(h);
        useGameStore.getState().setEditMode(true);
        useGameStore.getState().setPreview({ hdg: h });
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const h = getHdgFromEvent(e);
      if (h !== null) {
        setTargetHdg(h);
        writeSvg(h);
        checkSailChange(h);
        useGameStore.getState().setPreview({ hdg: h });
      }
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      svg.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? -1 : 1;
      setTargetHdg((prev) => {
        const base = prev ?? hdg;
        const h = (base + delta + 360) % 360;
        writeSvg(h);
        checkSailChange(h);
        if (h !== hdg) useGameStore.getState().setEditMode(true);
        useGameStore.getState().setPreview({ hdg: h });
        return h;
      });
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
  }, [hdg, writeSvg, checkSailChange]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && applyActive) {
        e.preventDefault();
        setShowModal(true);
      }
      if (e.key === 'Enter' && applyActive) {
        e.preventDefault();
        apply();
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        toggleTwaLock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── Apply heading ──
  const apply = () => {
    if (targetHdg === null) return;
    if (twaLocked) {
      const newTwa = ((targetHdg - twd + 540) % 360) - 180;
      setLockedTwa(newTwa);
      sendOrder({ type: 'TWA', value: { twa: newTwa } });
      useGameStore.getState().setPreview({ hdg: null, twaLocked: true, lockedTwa: newTwa });
    } else {
      sendOrder({ type: 'CAP', value: { heading: targetHdg } });
      useGameStore.getState().setPreview({ hdg: null });
    }
    useGameStore.getState().setHud({ hdg: targetHdg });
    setTargetHdg(null);
    setPendingSailChange(null);
    useGameStore.getState().setEditMode(false);
  };

  // ── Cancel editing ──
  const cancelEdit = () => {
    setTargetHdg(null);
    setPendingSailChange(null);
    setShowModal(false);
    useGameStore.getState().setEditMode(false);
    useGameStore.getState().setPreview({ hdg: null });
    writeSvg(hdg);
    const ghost = svgRef.current?.querySelector<SVGGElement>('#ghost');
    if (ghost) ghost.style.opacity = '0';
  };

  // ── Toggle TWA lock ──
  // Sends the order to the server immediately so the engine actually honours
  // the lock — without this, the boat keeps executing the last CAP order.
  const toggleTwaLock = () => {
    if (twaLocked) {
      setTwaLocked(false);
      useGameStore.getState().setPreview({ twaLocked: false });
      // Revert to heading mode: send current heading as a fresh CAP order
      sendOrder({ type: 'CAP', value: { heading: hdg } });
    } else {
      setTwaLocked(true);
      setLockedTwa(twa);
      useGameStore.getState().setPreview({ twaLocked: true, lockedTwa: twa });
      sendOrder({ type: 'TWA', value: { twa } });
    }
  };

  // ── Tick marks generation ──
  const ticks = [];
  for (let i = 0; i < 36; i++) {
    const deg = i * 10;
    const isCardinal = deg % 90 === 0;
    const isIntercardinal = deg % 45 === 0 && !isCardinal;
    const len = isCardinal ? 12 : isIntercardinal ? 10 : 6;
    const opacity = isCardinal ? 0.4 : isIntercardinal ? 0.25 : 0.15;
    const width = isCardinal ? 1.2 : 0.5;
    const p1 = pt(R_OUTER, deg);
    const p2 = pt(R_OUTER - len, deg);
    ticks.push(
      <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={`rgba(245,240,232,${opacity})`} strokeWidth={width} />
    );
  }

  // Cardinal labels
  const cardinals = [
    { label: 'N', deg: 0 }, { label: 'E', deg: 90 },
    { label: 'S', deg: 180 }, { label: 'O', deg: 270 },
  ];

  return (
    <>
      <div className={`${styles.wrapper} ${vmgGlow ? styles.vmgGlow : ''}`}>
        {/* Readouts */}
        <div className={styles.readouts}>
          <div>
            <p className={styles.readoutLabel}>Vit. bateau</p>
            <p className={`${styles.readoutValue} ${bspColor}`}>
              {displayBsp.toFixed(1)} <small>nds</small>
            </p>
          </div>
          <div>
            <p className={styles.readoutLabel}>Vent local</p>
            <p className={styles.readoutValue}>
              {tws.toFixed(1)} <small>nds</small>
            </p>
          </div>
          <div>
            <p className={styles.readoutLabel}>Cap</p>
            <p className={`${styles.readoutValue} ${styles.gold}`}>
              {Math.round(displayHdg)}°
            </p>
          </div>
          <div>
            <p className={styles.readoutLabel}>TWA</p>
            <p className={`${styles.readoutValue} ${vmgGlow ? styles.live : ''}`}>
              {Math.round(displayTwa)}°
            </p>
          </div>
        </div>

        {/* Compass SVG */}
        <div className={styles.stage}>
          <svg ref={svgRef} viewBox={`0 0 ${VB} ${VB}`} className={styles.svg}>
            {/* Circles */}
            <circle cx={CX} cy={CY} r={R_OUTER} fill="none"
              stroke="rgba(245,240,232,0.18)" strokeWidth="1" />
            <circle cx={CX} cy={CY} r={R_INNER} fill="none"
              stroke="rgba(245,240,232,0.08)" strokeWidth="0.5" />

            {/* Tick marks */}
            {ticks}

            {/* Cardinal labels (French: O for Ouest) */}
            {cardinals.map(({ label, deg }) => {
              const p = pt(R_OUTER - 20, deg);
              return (
                <text key={label} x={p.x} y={p.y}
                  fontFamily="Bebas Neue,sans-serif" fontSize="15"
                  fill="rgba(245,240,232,0.85)"
                  textAnchor="middle" dominantBaseline="central">
                  {label}
                </text>
              );
            })}

            {/* Degree labels every 30° (except cardinals at 0/90/180/270) */}
            {[30, 60, 120, 150, 210, 240, 300, 330].map((deg) => {
              const p = pt(R_OUTER - 32, deg);
              return (
                <text key={`deg-${deg}`} x={p.x} y={p.y}
                  fontFamily="Space Mono,monospace" fontSize="8" fontWeight="700"
                  fill="rgba(245,240,232,0.35)"
                  textAnchor="middle" dominantBaseline="central">
                  {String(deg).padStart(3, '0')}
                </text>
              );
            })}

            {/* Wind waves — animated, OUTSIDE the circle */}
            <WindWaves twd={twd} tws={tws} cx={CX} cy={CY} r={R_OUTER} />

            {/* Ghost of previous heading (shown during edit) */}
            <g id="ghost" transform={`rotate(${hdg} ${CX} ${CY})`} style={{ opacity: 0 }}>
              <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
                <path d={IMOCA_PATH}
                  fill="none" stroke="#f5f0e8" strokeWidth={8} strokeDasharray="12 8" />
              </g>
            </g>

            {/* Boat silhouette — IMOCA, oriented by heading */}
            <g id="boat" transform={`rotate(${hdg} ${CX} ${CY})`}>
              <line x1={CX} y1={CY - 26} x2={CX} y2={CY - 70}
                stroke="#f5f0e8" strokeWidth="1" opacity="0.5" strokeDasharray="4 3" />
              <g transform={`translate(${CX},${CY}) rotate(-90) scale(${IMOCA_SCALE}) translate(${-IMOCA_VB.w / 2},${-IMOCA_VB.h / 2})`}>
                <path d={IMOCA_PATH} fill="#c9a227" />
              </g>
            </g>

            {/* Center dot */}
            <circle cx={CX} cy={CY} r={3} fill="rgba(245,240,232,0.25)" />
          </svg>
        </div>

        {/* Sail change notification */}
        {pendingSailChange && (
          <div className={styles.sailNotif}>
            <span>⛵</span>
            <span>
              Changement de voile auto : <span className={styles.sailNotifStrong}>{pendingSailChange}</span>
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className={styles.actions}>
          <Tooltip text={twaLocked ? "TWA verrouillé — le cap suit le vent" : "Verrouiller le TWA"} shortcut="T" position="bottom">
            <button
              type="button"
              className={`${styles.actionBtn} ${twaLocked ? styles.locked : ''}`}
              onClick={toggleTwaLock}
            >
              {twaLocked
                ? <Lock size={14} strokeWidth={2.5} />
                : <LockOpen size={14} strokeWidth={2.5} />}
              <span>TWA</span>
            </button>
          </Tooltip>
          <Tooltip text="Appliquer le cap modifié" shortcut="Entrée" position="bottom">
            <button
              type="button"
              className={`${styles.actionBtn} ${applyActive ? styles.applyActive : styles.applyInactive}`}
              onClick={apply}
            >
              <Check size={14} strokeWidth={3} />
              {applyActive && targetHdg !== null ? <span>{Math.round(targetHdg)}°</span> : null}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Confirm modal */}
      {showModal && (
        <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.modalTitle}>Cap non appliqué</p>
            <p className={styles.modalText}>
              Vous avez modifié le cap cible à{' '}
              <strong style={{ color: '#c9a227' }}>
                {targetHdg !== null ? `${Math.round(targetHdg)}°` : ''}
              </strong>{' '}
              sans l&apos;appliquer.
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={`${styles.modalBtn} ${styles.modalBtnDanger}`}
                onClick={cancelEdit}>
                Annuler
              </button>
              <button type="button" className={`${styles.modalBtn} ${styles.modalBtnPrimary}`}
                onClick={() => setShowModal(false)}>
                Continuer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
