'use client';

import { useEffect, useRef, useState } from 'react';
import { sendOrder, useGameStore } from '@/lib/store';
import styles from './Compass.module.css';

/**
 * Compas VR-style — implémentation fidèle à l'addendum V3 §2.
 * - Toute la scène SVG est mise à jour par manipulation DOM directe
 *   (pas de React re-render pendant le drag → 60 fps garanti).
 * - Drag absolu sur l'anneau : le cap cible = angle pointé (pas delta).
 * - Scroll wheel sur desktop pour la précision ±1°.
 * - Bouton APPLIQUER obligatoire — aucun changement de cap n'est émis
 *   tant que l'utilisateur n'a pas confirmé.
 * - Lock CAP / TWA / VMG AUTO via les trois cellules du header.
 *
 * Les zones VMG et voile sont calculées une seule fois par changement de
 * TWD ou de voile puis écrites directement dans leurs <path>.
 */

const VB = 300;
const CX = VB / 2;
const CY = VB / 2;
const R_OUTER = 140;
const R_GRAD = 125;
const R_SAIL = 100;
const R_VMG = 115;
const R_TWA = 88;
const R_HUB = 34;

const SAIL_RANGES: Record<string, [number, number]> = {
  LW: [0, 60], JIB: [30, 100], GEN: [50, 140], C0: [60, 150], HG: [100, 170], SPI: [120, 180],
};

type LockMode = 'CAP' | 'TWA' | 'VMG';

function pt(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  // Arrondi au 4ème décimal pour éviter les mismatches SSR/CSR dus à la
  // précision flottante (Node et V8 navigateur peuvent différer au dernier ULP).
  const round = (n: number): number => Math.round(n * 10000) / 10000;
  return { x: round(CX + r * Math.cos(rad)), y: round(CY + r * Math.sin(rad)) };
}

function sector(r: number, d1: number, d2: number): string {
  const span = ((d2 - d1 + 360) % 360);
  const s = pt(r, d1);
  const e = pt(r, d2);
  return `M${CX},${CY} L${s.x.toFixed(1)},${s.y.toFixed(1)} A${r},${r},0,${span > 180 ? 1 : 0},1,${e.x.toFixed(1)},${e.y.toFixed(1)} Z`;
}

function shortSector(r: number, d1: number, d2: number): string {
  const diff = ((d2 - d1 + 360) % 360);
  return diff <= 180 ? sector(r, d1, d2) : sector(r, d2, d1);
}

function qualityColor(hdg: number, twd: number): { color: string; label: string } {
  let twa = ((hdg - twd + 360) % 360);
  if (twa > 180) twa -= 360;
  const a = Math.abs(twa);
  if (a < 28) return { color: '#f87171', label: 'ZONE MORTE' };
  if (a >= 38 && a <= 54) return { color: '#4ade80', label: 'VMG ↑' };
  if (a >= 140 && a <= 162) return { color: '#4ade80', label: 'VMG ↓' };
  if (a > 54 && a < 140) return { color: '#00d4ff', label: 'OPTIMAL' };
  return { color: 'rgba(232,244,255,.6)', label: 'CAP' };
}

export default function Compass(): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const targetHdgRef = useRef<number | null>(null);
  const [applyActive, setApplyActive] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [lockMode, setLockMode] = useState<LockMode>('CAP');
  const [lockedTwa, setLockedTwa] = useState<number>(0);

  const hud = useGameStore((s) => s.hud);
  const currentHdg = hud.hdg;
  const twd = hud.twd;
  const sail = hud.sail;

  // --- Mise à jour directe du SVG (hors React) ---
  const writeSvg = (targetHdg: number): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const q = qualityColor(targetHdg, twd);

    const boatTarget = svg.querySelector<SVGGElement>('#boatTarget');
    const twaArcTarget = svg.querySelector<SVGPathElement>('#twaArcTarget');
    const hubLabel = svg.querySelector<SVGTextElement>('#hubLabel');
    const hubValue = svg.querySelector<SVGTextElement>('#hubValue');
    const hubSub = svg.querySelector<SVGTextElement>('#hubSub');

    if (boatTarget) {
      boatTarget.setAttribute('transform', `rotate(${targetHdg} ${CX} ${CY})`);
      boatTarget.style.opacity = targetHdg === currentHdg ? '0' : '1';
    }
    if (twaArcTarget) {
      twaArcTarget.setAttribute('d', shortSector(R_TWA, twd, targetHdg));
      twaArcTarget.setAttribute('fill', q.color);
      twaArcTarget.style.opacity = targetHdg === currentHdg ? '0' : '0.20';
    }
    if (hubValue) hubValue.textContent = `${Math.round(targetHdg)}°`;
    if (hubSub) { hubSub.textContent = q.label; hubSub.setAttribute('fill', q.color); }
    if (hubLabel) hubLabel.textContent = lockMode === 'CAP' ? 'CAP CIBLE' : lockMode === 'TWA' ? 'TWA CIBLE' : 'VMG AUTO';
  };

  // Écrit l'état courant quand currentHdg/twd/sail change (mise à jour au tick WS).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const boatCurrent = svg.querySelector<SVGGElement>('#boatCurrent');
    const twaArc = svg.querySelector<SVGPathElement>('#twaArc');
    const windIndicator = svg.querySelector<SVGGElement>('#windIndicator');
    const sailStb = svg.querySelector<SVGPathElement>('#sailStb');
    const sailPort = svg.querySelector<SVGPathElement>('#sailPort');
    const vmgUp = svg.querySelector<SVGPathElement>('#vmgUp');
    const vmgDown = svg.querySelector<SVGPathElement>('#vmgDown');

    if (boatCurrent) boatCurrent.setAttribute('transform', `rotate(${currentHdg} ${CX} ${CY})`);
    if (twaArc) {
      const q = qualityColor(currentHdg, twd);
      twaArc.setAttribute('d', shortSector(R_TWA, twd, currentHdg));
      twaArc.setAttribute('fill', q.color);
    }
    if (windIndicator) windIndicator.setAttribute('transform', `rotate(${twd} ${CX} ${CY})`);
    if (vmgUp) vmgUp.setAttribute('d', sector(R_VMG, (twd - 48 + 360) % 360, (twd + 48) % 360));
    if (vmgDown) {
      const downCenter = (twd + 180) % 360;
      vmgDown.setAttribute('d', sector(R_VMG, (downCenter - 32 + 360) % 360, (downCenter + 32) % 360));
    }
    const range = SAIL_RANGES[sail] ?? [0, 180];
    const [mn, mx] = range;
    if (sailStb) sailStb.setAttribute('d', sector(R_SAIL, (twd + mn) % 360, (twd + mx) % 360));
    if (sailPort) sailPort.setAttribute('d', sector(R_SAIL, (twd - mx + 360) % 360, (twd - mn + 360) % 360));

    // si aucun drag en cours, synchroniser la cible avec le courant
    if (targetHdgRef.current === null) writeSvg(currentHdg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHdg, twd, sail, lockMode]);

  // TWA lock : si le TWD bouge, le cap cible et effectif suit.
  useEffect(() => {
    if (lockMode === 'TWA') {
      const newHdg = ((twd + lockedTwa) + 360) % 360;
      useGameStore.getState().setHud({ hdg: Math.round(newHdg) });
    }
  }, [lockMode, lockedTwa, twd]);

  // --- Drag absolu ---
  const getHdgFromEvent = (e: PointerEvent): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (dx * dx + dy * dy < 900) return null;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    return Math.round(angle) % 360;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let dragging = false;

    const onDown = (e: PointerEvent): void => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      const h = getHdgFromEvent(e);
      if (h !== null) { targetHdgRef.current = h; writeSvg(h); setApplyActive(true); }
    };
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const h = getHdgFromEvent(e);
      if (h !== null) { targetHdgRef.current = h; writeSvg(h); }
    };
    const onUp = (e: PointerEvent): void => {
      dragging = false;
      svg.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? -1 : 1;
      const base = targetHdgRef.current ?? currentHdg;
      const h = (base + delta + 360) % 360;
      targetHdgRef.current = h; writeSvg(h); setApplyActive(h !== currentHdg);
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
  }, [currentHdg]);

  const apply = (): void => {
    const target = targetHdgRef.current;
    if (target === null) return;
    if (lockMode === 'TWA') {
      let newTwa = ((target - twd + 540) % 360) - 180;
      if (newTwa === -180) newTwa = 180;
      setLockedTwa(newTwa);
      // Envoi RPC au serveur — l'envelope sera enrichie (trustedTs, effectiveTs, connectionId).
      sendOrder({ type: 'TWA', value: { twa: newTwa } });
    } else {
      sendOrder({ type: 'CAP', value: { heading: target } });
    }
    // Maj optimiste locale pour retour UX immédiat (le broadcast serveur
    // confirmera/écrasera dans les 30s max).
    useGameStore.getState().setHud({ hdg: target });
    targetHdgRef.current = null;
    setApplyActive(false);
    setFlashing(true);
    setTimeout(() => setFlashing(false), 500);
  };

  const twaSigned = ((currentHdg - twd + 540) % 360) - 180;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <button
          type="button"
          className={`${styles.lockCell} ${lockMode === 'CAP' ? styles.lockActive : ''}`}
          onClick={() => setLockMode('CAP')}
        >
          <span className={styles.lockLabel}>{lockMode === 'CAP' && '🔒'} CAP</span>
          <span className={styles.lockValue}>{Math.round(currentHdg)}°</span>
        </button>
        <button
          type="button"
          className={`${styles.lockCell} ${lockMode === 'TWA' ? styles.lockActiveTwa : ''}`}
          onClick={() => { setLockMode('TWA'); setLockedTwa(twaSigned); }}
        >
          <span className={styles.lockLabel}>{lockMode === 'TWA' && '🔒'} TWA</span>
          <span className={styles.lockValue}>
            {twaSigned >= 0 ? '+' : ''}{twaSigned.toFixed(0)}°
          </span>
        </button>
        <button
          type="button"
          className={`${styles.lockCell} ${lockMode === 'VMG' ? styles.lockActive : ''}`}
          onClick={() => setLockMode('VMG')}
        >
          <span className={styles.lockLabel}>VMG</span>
          <span className={styles.lockValue}>AUTO</span>
        </button>
      </div>

      <div className={styles.root}>
        <svg ref={svgRef} viewBox={`0 0 ${VB} ${VB}`} className={styles.svg}>
          <defs>
            <radialGradient id="bg-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0b1d33" stopOpacity="1" />
              <stop offset="60%" stopColor="#081525" stopOpacity="1" />
              <stop offset="100%" stopColor="#060a0f" stopOpacity="1" />
            </radialGradient>
          </defs>

          {/* Fond + anneau extérieur */}
          <circle cx={CX} cy={CY} r={R_OUTER} fill="url(#bg-grad)" stroke="rgba(0,212,255,0.18)" strokeWidth="1.5" />
          <circle cx={CX} cy={CY} r={R_OUTER - 16} fill="none" stroke="rgba(0,212,255,0.08)" strokeWidth="1" />

          {/* Zones VMG */}
          <path id="vmgUp" d="" fill="rgba(74,222,128,0.08)" />
          <path id="vmgDown" d="" fill="rgba(74,222,128,0.06)" />

          {/* Zone voile courante */}
          <path id="sailStb" d="" fill="rgba(251,191,36,0.10)" />
          <path id="sailPort" d="" fill="rgba(251,191,36,0.10)" />

          {/* Arc TWA courant + cible */}
          <path id="twaArc" d="" fill="#00d4ff" opacity="0.28" />
          <path id="twaArcTarget" d="" fill="#fbbf24" opacity="0" strokeDasharray="4 3" />

          {/* Graduations */}
          <g>
            {Array.from({ length: 72 }).map((_, i) => {
              const deg = i * 5;
              const major = deg % 30 === 0;
              const p1 = pt(R_GRAD, deg);
              const p2 = pt(R_GRAD - (major ? 10 : 4), deg);
              return (
                <line
                  key={i}
                  x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke={major ? 'rgba(224,247,255,0.55)' : 'rgba(224,247,255,0.22)'}
                  strokeWidth={major ? 1.2 : 0.6}
                />
              );
            })}
            {['N', 'E', 'S', 'W'].map((card, i) => {
              const p = pt(R_GRAD - 22, i * 90);
              return (
                <text
                  key={card} x={p.x} y={p.y}
                  fill={card === 'N' ? '#00d4ff' : 'rgba(224,247,255,0.55)'}
                  fontFamily="var(--font-display)"
                  fontSize="14" textAnchor="middle" dominantBaseline="central"
                  style={{ letterSpacing: '0.05em' }}
                >{card}</text>
              );
            })}
          </g>

          {/* Indicateur TWD */}
          <g id="windIndicator" transform={`rotate(${twd} ${CX} ${CY})`}>
            <path d={`M${CX},${CY - R_OUTER + 6} L${CX - 6},${CY - R_OUTER + 18} L${CX + 6},${CY - R_OUTER + 18} Z`}
                  fill="#00d4ff" />
            <text x={CX} y={CY - R_OUTER + 32} fill="rgba(0,212,255,0.75)"
                  fontFamily="var(--font-mono)" fontSize="9" textAnchor="middle"
                  style={{ letterSpacing: '0.14em' }}>TWD</text>
          </g>

          {/* Bateau cible (tirets) */}
          <g id="boatTarget" style={{ opacity: 0 }}>
            <path
              d={`M${CX},${CY - 56} L${CX - 14},${CY + 24} L${CX},${CY + 14} L${CX + 14},${CY + 24} Z`}
              fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4 3"
            />
          </g>

          {/* Bateau courant */}
          <g id="boatCurrent">
            <path
              d={`M${CX},${CY - 56} L${CX - 14},${CY + 24} L${CX},${CY + 14} L${CX + 14},${CY + 24} Z`}
              fill="#00d4ff" opacity="0.92"
            />
            <circle cx={CX} cy={CY - 30} r="3" fill="#e0f7ff" />
          </g>

          {/* Hub central */}
          <circle cx={CX} cy={CY} r={R_HUB} fill="#060a0f" stroke="rgba(0,212,255,0.35)" strokeWidth="1" />
          <text id="hubLabel" x={CX} y={CY - 12} fill="rgba(224,247,255,0.55)"
                fontFamily="var(--font-mono)" fontSize="8" textAnchor="middle"
                style={{ letterSpacing: '0.16em' }}>CAP</text>
          <text id="hubValue" x={CX} y={CY + 6} fill="#e0f7ff"
                fontFamily="var(--font-display)" fontSize="22" textAnchor="middle">
            {Math.round(currentHdg)}°
          </text>
          <text id="hubSub" x={CX} y={CY + 22} fill="#00d4ff"
                fontFamily="var(--font-mono)" fontSize="8" textAnchor="middle"
                style={{ letterSpacing: '0.18em' }}>OPTIMAL</text>

          {/* Triangle pointeur fixe (haut) */}
          <path d={`M${CX},${CY - R_OUTER - 4} L${CX - 7},${CY - R_OUTER - 18} L${CX + 7},${CY - R_OUTER - 18} Z`}
                fill="#e0f7ff" opacity="0.55" />
        </svg>

        <button
          type="button"
          className={`${styles.apply} ${applyActive ? styles.applyActive : ''} ${flashing ? styles.flash : ''}`}
          onClick={apply}
        >
          APPLIQUER
        </button>
      </div>
    </div>
  );
}
