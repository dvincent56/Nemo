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

/** Animated wind waves — ondulating arrows hitting the compass */
function WindWaves({ twd, tws, cx, cy, r }: { twd: number; tws: number; cx: number; cy: number; r: number }): React.ReactElement {
  const count = tws < 10 ? 1 : tws <= 25 ? 2 : 3;
  const waves = [];
  for (let i = 0; i < count; i++) {
    const offset = r + 8 + i * 10; // stagger outward
    waves.push(
      <g key={i} transform={`rotate(${twd} ${cx} ${cy})`}>
        <path
          d={`M${cx - 8},${cy - offset} Q${cx - 4},${cy - offset - 3} ${cx},${cy - offset} Q${cx + 4},${cy - offset + 3} ${cx + 8},${cy - offset}`}
          fill="none"
          stroke="rgba(245,240,232,0.5)"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <animate
            attributeName="d"
            values={`M${cx - 8},${cy - offset} Q${cx - 4},${cy - offset - 3} ${cx},${cy - offset} Q${cx + 4},${cy - offset + 3} ${cx + 8},${cy - offset};M${cx - 8},${cy - offset} Q${cx - 4},${cy - offset + 3} ${cx},${cy - offset} Q${cx + 4},${cy - offset - 3} ${cx + 8},${cy - offset};M${cx - 8},${cy - offset} Q${cx - 4},${cy - offset - 3} ${cx},${cy - offset} Q${cx + 4},${cy - offset + 3} ${cx + 8},${cy - offset}`}
            dur={`${1.5 + i * 0.3}s`}
            repeatCount="indefinite"
          />
        </path>
        {/* Small arrowhead */}
        <path
          d={`M${cx + 6},${cy - offset} L${cx + 10},${cy - offset - 3} L${cx + 10},${cy - offset + 3} Z`}
          fill="rgba(245,240,232,0.4)"
          transform={`rotate(${twd} ${cx} ${cy})`}
        >
          <animate
            attributeName="opacity"
            values="0.4;0.7;0.4"
            dur={`${1.5 + i * 0.3}s`}
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
    const hubText = svg.querySelector<SVGTextElement>('#hubText');

    if (boat && targetHdgRef.current === null) {
      boat.setAttribute('transform', `rotate(${hdg} ${CX} ${CY})`);
    }
    if (ghost) {
      ghost.setAttribute('transform', `rotate(${hdg} ${CX} ${CY})`);
      ghost.style.opacity = '0';
    }
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
              <g transform={`translate(${CX},${CX})`}>
                <path d="M 0,-26 C 7,-24 10,-15 10,-3 C 10,9 7,17 5,23 L 0,27 L -5,23 C -7,17 -10,9 -10,-3 C -10,-15 -7,-24 0,-26 Z"
                  fill="none" stroke="#f5f0e8" strokeWidth="1" strokeDasharray="3 2" />
              </g>
            </g>

            {/* Boat silhouette — oriented by heading (or target during drag) */}
            <g id="boat" transform={`rotate(${hdg} ${CX} ${CY})`}>
              <g transform={`translate(${CX},${CX})`}>
                <line x1="0" y1="-26" x2="0" y2="-70" stroke="#f5f0e8" strokeWidth="1" opacity="0.5" strokeDasharray="4 3" />
                <path d="M 0,-26 C 7,-24 10,-15 10,-3 C 10,9 7,17 5,23 L 0,27 L -5,23 C -7,17 -10,9 -10,-3 C -10,-15 -7,-24 0,-26 Z"
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
