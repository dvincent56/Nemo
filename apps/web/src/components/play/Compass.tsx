'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sendOrder, useGameStore } from '@/lib/store';
import styles from './Compass.module.css';

/* ── Constants ────────────────────────────────────── */
const VB = 220; // viewBox size
const CX = VB / 2;
const CY = VB / 2;
const R_OUTER = 96;
const R_INNER = 82;

const SAIL_RANGES: Record<string, [number, number]> = {
  LW: [0, 60], JIB: [30, 100], GEN: [50, 140],
  C0: [60, 150], HG: [100, 170], SPI: [120, 180],
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
  const order = ['SPI', 'C0', 'HG', 'GEN', 'JIB', 'LW'];
  for (const s of order) {
    const [mn, mx] = SAIL_RANGES[s]!;
    if (absT >= mn && absT <= mx) return s;
  }
  return null;
}

export default function Compass(): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const targetHdgRef = useRef<number | null>(null);
  const [applyActive, setApplyActive] = useState(false);
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
  const currentSail = useGameStore((s) => s.sail.currentSail);
  const sailAuto = useGameStore((s) => s.sail.sailAuto);

  // Computed
  const vmgGlow = isInVmgZone(twa);
  const targetHdg = targetHdgRef.current;
  const targetTwa = targetHdg !== null ? ((targetHdg - twd + 540) % 360) - 180 : null;

  // Check sail change implication when editing
  const checkSailChange = useCallback((newHdg: number) => {
    if (!sailAuto) { setPendingSailChange(null); return; }
    const newTwa = Math.abs(((newHdg - twd + 540) % 360) - 180);
    const newBest = bestSailForTwa(newTwa);
    if (newBest && newBest !== currentSail) {
      setPendingSailChange(`${currentSail} → ${newBest}`);
    } else {
      setPendingSailChange(null);
    }
  }, [sailAuto, twd, currentSail]);

  // ── SVG direct DOM update (60fps during drag) ──
  const writeSvg = useCallback((target: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');
    const hubText = svg.querySelector<SVGTextElement>('#hubText');

    if (boat) boat.setAttribute('transform', `rotate(${target} ${CX} ${CY})`);
    if (ghost) ghost.style.opacity = target === hdg ? '0' : '0.2';
    if (hubText) hubText.textContent = `${Math.round(target)}°`;
  }, [hdg]);

  // Sync SVG when hdg/twd changes from server
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const boat = svg.querySelector<SVGGElement>('#boat');
    const ghost = svg.querySelector<SVGGElement>('#ghost');
    const wind = svg.querySelector<SVGGElement>('#windArrow');
    const hubText = svg.querySelector<SVGTextElement>('#hubText');

    if (boat && targetHdgRef.current === null) {
      boat.setAttribute('transform', `rotate(${hdg} ${CX} ${CY})`);
    }
    if (ghost) {
      ghost.setAttribute('transform', `rotate(${hdg} ${CX} ${CY})`);
      ghost.style.opacity = '0';
    }
    if (wind) wind.setAttribute('transform', `rotate(${twd} ${CX} ${CY})`);
    if (hubText && targetHdgRef.current === null) hubText.textContent = `${Math.round(hdg)}°`;
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
        targetHdgRef.current = h;
        writeSvg(h);
        checkSailChange(h);
        setApplyActive(true);
        useGameStore.getState().setEditMode(true);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const h = getHdgFromEvent(e);
      if (h !== null) {
        targetHdgRef.current = h;
        writeSvg(h);
        checkSailChange(h);
      }
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      svg.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? -1 : 1;
      const base = targetHdgRef.current ?? hdg;
      const h = (base + delta + 360) % 360;
      targetHdgRef.current = h;
      writeSvg(h);
      checkSailChange(h);
      setApplyActive(h !== hdg);
      if (h !== hdg) useGameStore.getState().setEditMode(true);
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
    const target = targetHdgRef.current;
    if (target === null) return;
    if (twaLocked) {
      const newTwa = ((target - twd + 540) % 360) - 180;
      setLockedTwa(newTwa);
      sendOrder({ type: 'TWA', value: { twa: newTwa } });
    } else {
      sendOrder({ type: 'CAP', value: { heading: target } });
    }
    useGameStore.getState().setHud({ hdg: target });
    targetHdgRef.current = null;
    setApplyActive(false);
    setPendingSailChange(null);
    useGameStore.getState().setEditMode(false);
  };

  // ── Cancel editing ──
  const cancelEdit = () => {
    targetHdgRef.current = null;
    setApplyActive(false);
    setPendingSailChange(null);
    setShowModal(false);
    useGameStore.getState().setEditMode(false);
    // Reset SVG to current heading
    writeSvg(hdg);
    const ghost = svgRef.current?.querySelector<SVGGElement>('#ghost');
    if (ghost) ghost.style.opacity = '0';
  };

  // ── Toggle TWA lock ──
  const toggleTwaLock = () => {
    if (twaLocked) {
      setTwaLocked(false);
    } else {
      setTwaLocked(true);
      setLockedTwa(twa);
    }
  };

  // ── Wind direction label (French cardinal) ──
  const windCardinal = (deg: number): string => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    return dirs[Math.round(deg / 45) % 8] ?? 'N';
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
            <p className={`${styles.readoutValue} ${styles.live}`}>
              {bsp.toFixed(1)} <small>nds</small>
            </p>
          </div>
          <div>
            <p className={styles.readoutLabel}>Vent local</p>
            <p className={styles.readoutValue}>
              {tws.toFixed(1)} <small>nds</small>
            </p>
          </div>
          <div>
            <p className={styles.readoutLabel}>
              Cap
              {applyActive && <span className={styles.editTag}>▸ CIBLE</span>}
              {twaLocked && !applyActive && <span className={styles.editTag}>🔒 AUTO</span>}
            </p>
            <p className={`${styles.readoutValue} ${styles.gold}`}>
              {applyActive && targetHdg !== null ? `${Math.round(targetHdg)}°` : `${Math.round(hdg)}°`}
            </p>
          </div>
          <div>
            <p className={styles.readoutLabel}>
              TWA
              {applyActive && <span className={styles.editTag}>▸ ESTIMÉ</span>}
              {twaLocked && !applyActive && <span className={styles.editTag}>🔒 VERROUILLÉ</span>}
            </p>
            <p className={`${styles.readoutValue} ${vmgGlow && !applyActive ? styles.live : ''}`}>
              {applyActive && targetTwa !== null ? `${Math.round(targetTwa)}°` : `${Math.round(twa)}°`}
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

            {/* Wind arrow — OUTSIDE the circle */}
            <g id="windArrow" transform={`rotate(${twd} ${CX} ${CY})`}>
              <line x1={CX} y1={CY - R_OUTER - 10} x2={CX} y2={CY - R_OUTER - 2}
                stroke="rgba(245,240,232,0.55)" strokeWidth="1.5" strokeLinecap="round" />
              <path d={`M${CX},${CY - R_OUTER} L${CX - 4},${CY - R_OUTER - 8} L${CX},${CY - R_OUTER - 5} L${CX + 4},${CY - R_OUTER - 8} Z`}
                fill="rgba(245,240,232,0.55)" />
              <text x={CX} y={CY - R_OUTER - 14}
                fontFamily="Space Mono,monospace" fontSize="7" fontWeight="700"
                fill="rgba(245,240,232,0.45)" textAnchor="middle">
                {windCardinal(twd)}
              </text>
            </g>

            {/* Ghost of previous heading (shown during edit) */}
            <g id="ghost" transform={`rotate(${hdg} ${CX} ${CY})`} style={{ opacity: 0 }}>
              <g transform={`translate(${CX},${CX})`}>
                <path d="M 0,-20 C 5.5,-18 7.5,-11 7.5,-2 C 7.5,7 5.5,13 3.5,18 L 0,21 L -3.5,18 C -5.5,13 -7.5,7 -7.5,-2 C -7.5,-11 -5.5,-18 0,-20 Z"
                  fill="none" stroke="#f5f0e8" strokeWidth="1" strokeDasharray="3 2" />
              </g>
            </g>

            {/* Boat silhouette — oriented by heading (or target during drag) */}
            <g id="boat" transform={`rotate(${hdg} ${CX} ${CY})`}>
              <g transform={`translate(${CX},${CX})`}>
                <path d="M 0,-20 C 5.5,-18 7.5,-11 7.5,-2 C 7.5,7 5.5,13 3.5,18 L 0,21 L -3.5,18 C -5.5,13 -7.5,7 -7.5,-2 C -7.5,-11 -5.5,-18 0,-20 Z"
                  fill="#c9a227" stroke="#1a2840" strokeWidth="0.8" />
                <line x1="0" y1="-16" x2="0" y2="16" stroke="#1a2840" strokeWidth="0.6" opacity="0.5" />
                <circle cx="0" cy="-5" r="1.5" fill="#1a2840" />
              </g>
            </g>

            {/* Center hub */}
            <circle cx={CX} cy={CY} r={16} fill="rgba(12,20,36,0.85)"
              stroke="rgba(245,240,232,0.20)" strokeWidth="0.8" />
            <text id="hubText" x={CX} y={CX - 2}
              fontFamily="Bebas Neue,sans-serif" fontSize="15"
              fill="#c9a227" textAnchor="middle" dominantBaseline="central">
              {Math.round(hdg)}°
            </text>
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
          <button
            type="button"
            className={`${styles.actionBtn} ${twaLocked ? styles.locked : ''}`}
            onClick={toggleTwaLock}
            title="Verrouiller TWA (T)"
          >
            🔒 TWA
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${applyActive ? styles.applyActive : styles.applyInactive}`}
            onClick={apply}
            title="Appliquer le cap (Entrée)"
          >
            {applyActive && targetHdg !== null ? `✓ Appliquer ${Math.round(targetHdg)}°` : 'Appliquer'}
          </button>
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
