'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SailId } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance/browser';
import { sendOrder, useGameStore } from '@/lib/store';
import { loadPolar, getCachedPolar, getPolarSpeed } from '@/lib/polar';
import { pickOptimalSail } from '@/lib/polar/pickOptimalSail';
import { predictAfterHdg } from '@/lib/optimistic/predictAfterHdg';
import { Lock, LockOpen, Check, AlertTriangle } from 'lucide-react';
import styles from './Compass.module.css';
import Tooltip from '@/components/ui/Tooltip';
import { VB, IMOCA_VB, IMOCA_PATH, IMOCA_SCALE, CX, CY, R_OUTER, R_INNER, pt, isInVmgZone } from './compass/compassGeometry';

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
  // Mirror of the last lock state we committed to the server — updated
  // optimistically on apply() so the Valider button greys out immediately
  // rather than waiting 2-3 s for the next tick broadcast to round-trip.
  const [committedTwaLock, setCommittedTwaLock] = useState<number | null>(null);

  // Store subscriptions
  const hdg = useGameStore((s) => s.hud.hdg);
  const twd = useGameStore((s) => s.hud.twd);
  const tws = useGameStore((s) => s.hud.tws);
  const twa = useGameStore((s) => s.hud.twa);
  const serverTwaLock = useGameStore((s) => s.hud.twaLock);
  const boatClass = useGameStore((s) => s.hud.boatClass);
  const currentSail = useGameStore((s) => s.sail.currentSail);
  const sailAuto = useGameStore((s) => s.sail.sailAuto);
  const transitionEndMs = useGameStore((s) => s.sail.transitionEndMs);
  const maneuverEndMs = useGameStore((s) => s.sail.maneuverEndMs);
  const maneuverKind = useGameStore((s) => s.sail.maneuverKind);
  const actualBsp = useGameStore((s) => s.hud.bsp);
  const bspBaseMultiplier = useGameStore((s) => s.hud.bspBaseMultiplier);
  const [polarReady, setPolarReady] = useState(() => !!boatClass && !!getCachedPolar(boatClass));
  useEffect(() => {
    if (!boatClass) return;
    if (getCachedPolar(boatClass)) { setPolarReady(true); return; }
    loadPolar(boatClass).then(() => setPolarReady(true)).catch(() => {});
  }, [boatClass]);

  // Lock state differs from the last committed value → needs validation.
  // committedTwaLock mirrors what we've told the server (optimistically on
  // apply, or via server broadcast sync below), so the Valider button
  // deactivates immediately after click.
  const lockStateChanged =
    (twaLocked && committedTwaLock === null) ||
    (!twaLocked && committedTwaLock !== null) ||
    (twaLocked && committedTwaLock !== null && Math.round(lockedTwa) !== Math.round(committedTwaLock));

  // Displayed values — live update during drag
  const applyActive = (targetHdg !== null && targetHdg !== hdg) || lockStateChanged;
  const displayHdg = targetHdg ?? hdg;
  const displayTwa = ((displayHdg - twd + 540) % 360) - 180;
  const vmgGlow = isInVmgZone(displayTwa);

  const polar = (polarReady && boatClass) ? getCachedPolar(boatClass) : null;
  // Vitesse estimée d'après la polaire (TWS, TWA affiché, voile courante) × multiplicateur
  // de base. Exclut volontairement les pénalités transitoires (transition de voile,
  // manœuvre, zone) : le HUD montre déjà la vitesse réelle réduite, le compass sert
  // de référence "régime établi" pour la voile/cap actuels (et le cap cible en drag).
  const displayBsp = polar
    ? getPolarSpeed(polar, currentSail, displayTwa, tws) * bspBaseMultiplier
    : actualBsp;

  // Efficacité : compare la voile active à la meilleure voile au même TWA/TWS.
  // Green = on est sur la meilleure voile à cet angle. Rouge = il existe une
  // voile bien plus rapide ; en auto la bascule va arriver, en manuel c'est
  // un signal de changement à faire.
  const bestPolarAtTwa = polar
    ? Math.max(...(Object.keys(polar.speeds) as SailId[]).map((s) => getPolarSpeed(polar, s, displayTwa, tws)))
    : 0;
  const bspRatio = bestPolarAtTwa > 0 ? displayBsp / bestPolarAtTwa : 1;
  const bspColor = bspRatio >= 0.95 ? styles.live   // vert — voile optimale ou quasi
    : bspRatio >= 0.80 ? styles.warn                 // orange — une meilleure voile existe
    : styles.danger;                                 // rouge — voile fortement sous-optimale

  // ── Hint "la validation va déclencher une manœuvre" ─────────────────
  // Affiché pendant l'édition de cap quand la validation provoquera un coût
  // visible : virement (TWA change de bord, |newTwa|<90), empannage (idem
  // mais |newTwa|>90), ou changement de voile auto (nouveau TWA → autre voile
  // optimale). Si plusieurs s'appliquent, on affiche le plus contraignant :
  // empannage > virement > changement de voile (durées & pénalités de vitesse
  // décroissantes). Le message est rendu en absolute au-dessus du compass
  // pour ne pas modifier sa hauteur quand il apparaît/disparaît.
  let pendingHint: { kind: 'gybe' | 'tack' | 'sail'; label: string; className: string } | null = null;
  if (applyActive && polar && boatClass) {
    const sameSign = Math.sign(displayTwa) === Math.sign(twa) || twa === 0;
    const isManeuver = !sameSign && displayTwa !== 0 && twa !== 0;
    const isTack = isManeuver && Math.abs(displayTwa) < 90;
    const isGybe = isManeuver && Math.abs(displayTwa) >= 90;

    if (isGybe) {
      const dur = GameBalance.maneuvers?.gybe?.durationSec?.[boatClass] ?? 120;
      const pct = Math.round((1 - (GameBalance.maneuvers?.gybe?.speedFactor ?? 0.55)) * 100);
      pendingHint = { kind: 'gybe', label: `Empannage — vitesse −${pct}% (~${dur}s)`, className: styles.hintGybe! };
    } else if (isTack) {
      const dur = GameBalance.maneuvers?.tack?.durationSec?.[boatClass] ?? 90;
      const pct = Math.round((1 - (GameBalance.maneuvers?.tack?.speedFactor ?? 0.60)) * 100);
      pendingHint = { kind: 'tack', label: `Virement — vitesse −${pct}% (~${dur}s)`, className: styles.hintTack! };
    } else if (sailAuto) {
      const optimal = pickOptimalSail(polar, displayTwa, tws);
      if (optimal !== currentSail) {
        const key = `${currentSail}_${optimal}`;
        const dur = (GameBalance.sails?.transitionTimes as Record<string, number> | undefined)?.[key] ?? 180;
        const pct = Math.round((1 - (GameBalance.sails?.transitionPenalty ?? 0.7)) * 100);
        pendingHint = { kind: 'sail', label: `Voile auto : ${currentSail} → ${optimal} (−${pct}% ~${dur}s)`, className: styles.hintSail! };
      }
    }
  }

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

  // Sync local lock state from server — reflect authoritative state in
  // both the preview toggle and the committed mirror, so the UI stays
  // aligned if the server clears/changes the lock externally.
  useEffect(() => {
    if (serverTwaLock !== null) {
      setTwaLocked(true);
      setLockedTwa(serverTwaLock);
    } else {
      setTwaLocked(false);
    }
    setCommittedTwaLock(serverTwaLock);
  }, [serverTwaLock]);

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
        useGameStore.getState().setPreview({ hdg: h });
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const h = getHdgFromEvent(e);
      if (h !== null) {
        setTargetHdg(h);
        writeSvg(h);
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
  }, [hdg, writeSvg]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && applyActive) {
        e.preventDefault();
        cancelEdit();
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

  // ── Apply heading / lock state ──
  // A single validation path: commits both heading changes AND lock toggles
  // so the player can compose the two (e.g. drag + lock) then validate once.
  // Orders are rounded to integer degrees to match what the UI displays —
  // otherwise TWA derived from (hdg − twd) carries the fractional TWD and
  // the engine ends up computing on e.g. 169.70° when the player saw 170°.
  const apply = () => {
    if (!applyActive) return;
    const store = useGameStore.getState();
    if (twaLocked) {
      const newTwaRaw = targetHdg !== null
        ? ((targetHdg - twd + 540) % 360) - 180
        : lockedTwa;
      const newTwa = Math.round(newTwaRaw);
      setLockedTwa(newTwa);
      sendOrder({ type: 'TWA', value: { twa: newTwa } });
      setCommittedTwaLock(newTwa);
      store.setPreview({ hdg: null, twaLocked: true, lockedTwa: newTwa });
    } else {
      const heading = Math.round(targetHdg ?? hdg);
      sendOrder({ type: 'CAP', value: { heading } });
      setCommittedTwaLock(null);
      store.setPreview({ hdg: null, twaLocked: false });
    }

    // Optimistic full-state mirror: predict what the server's next tick will
    // return for hdg, twa, bsp, sail-change and maneuver, and patch the store
    // immediately. mergeField in the tick handler preserves these optimistic
    // values until the server confirms convergence.
    if (targetHdg !== null && polar && boatClass) {
      const newHdg = Math.round(targetHdg);
      const patch = predictAfterHdg({
        newHdg,
        prevTwa: twa,
        twd,
        tws,
        currentSail,
        sailAuto,
        bspBaseMultiplier,
        transitionEndMs,
        maneuverEndMs,
        maneuverKind,
        polar,
        boatClass,
        now: Date.now(),
      });
      store.applyOptimisticHud(patch.hud);
      if (patch.sail.maneuver) {
        store.applyOptimisticManeuver({
          maneuverKind: patch.sail.maneuver.kind,
          maneuverStartMs: patch.sail.maneuver.startMs,
          maneuverEndMs: patch.sail.maneuver.endMs,
        });
      }
      if (patch.sail.sailChange) {
        store.setOptimisticSailChange(patch.sail.sailChange);
      }
    }
    setTargetHdg(null);
  };

  // ── Cancel editing ──
  const cancelEdit = () => {
    setTargetHdg(null);
    if (committedTwaLock !== null) {
      setTwaLocked(true);
      setLockedTwa(committedTwaLock);
      useGameStore.getState().setPreview({ hdg: null, twaLocked: true, lockedTwa: committedTwaLock });
    } else {
      setTwaLocked(false);
      useGameStore.getState().setPreview({ hdg: null, twaLocked: false });
    }
    writeSvg(hdg);
    const ghost = svgRef.current?.querySelector<SVGGElement>('#ghost');
    if (ghost) ghost.style.opacity = '0';
  };

  // ── Toggle TWA lock (preview only) ──
  // Toggling the lock button never commits an order by itself — it only
  // updates the local preview so the projection line reflects the new mode.
  // The player must click Apply (check button) or hit Entrée to validate.
  // If the player is currently previewing a heading (compass drag), we lock
  // on THAT preview's TWA; otherwise we lock on the current live TWA.
  const toggleTwaLock = () => {
    if (twaLocked) {
      setTwaLocked(false);
      useGameStore.getState().setPreview({ twaLocked: false });
    } else {
      const rawTwa = targetHdg !== null
        ? (((targetHdg - twd + 540) % 360) - 180)
        : twa;
      const effectiveTwa = Math.round(rawTwa);
      setTwaLocked(true);
      setLockedTwa(effectiveTwa);
      useGameStore.getState().setPreview({ twaLocked: true, lockedTwa: effectiveTwa });
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
        {/* Floating hint (position: absolute) — shown only during edit when
            the validation would trigger a maneuver. Doesn't alter wrapper
            height so the compass stays stable when it appears/disappears. */}
        {pendingHint && (
          <div className={`${styles.floatingHint} ${pendingHint.className}`}>
            <span className={styles.hintIcon}><AlertTriangle size={12} strokeWidth={2.5} /></span>
            <span>{pendingHint.label}</span>
          </div>
        )}

        {/* Readouts — 3 colonnes : Vitesse / Cap / TWA (TWS est dans le HUD) */}
        <div className={styles.readouts}>
          <div>
            <p className={styles.readoutLabel}>Vitesse</p>
            <p className={`${styles.readoutValue} ${bspColor}`}>
              {displayBsp.toFixed(2)} <small>nds</small>
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
                  className={styles.cardinalLabel}
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
                  className={styles.degreeLabel}
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
          <Tooltip text="Valider l'ordre (cap ou TWA lock)" shortcut="Entrée" position="bottom">
            <button
              type="button"
              className={`${styles.actionBtn} ${applyActive ? styles.applyActive : styles.applyInactive}`}
              onClick={apply}
            >
              <Check size={14} strokeWidth={3} />
              <span>Valider</span>
            </button>
          </Tooltip>
          <Tooltip text="Annuler le changement en cours" shortcut="Échap" position="bottom">
            <button
              type="button"
              className={`${styles.actionBtn} ${applyActive ? styles.cancelActive : styles.cancelInactive}`}
              onClick={cancelEdit}
              disabled={!applyActive}
              aria-label="Annuler"
            >
              <span className={styles.cancelX} aria-hidden="true">×</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
