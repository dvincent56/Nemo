'use client';

import { useEffect, useRef, useState } from 'react';
import type { SailId } from '@nemo/shared-types';
import { sendOrder, useGameStore } from '@/lib/store';
import { loadPolar, getCachedPolar, getPolarSpeed } from '@/lib/polar';
import { pickOptimalSail } from '@/lib/polar/pickOptimalSail';
import styles from './SailPanel.module.css';

/* ── Sail icon SVGs (vue de profil, mât à gauche) ── */
const SAIL_ICONS: Record<SailId, React.ReactElement> = {
  JIB: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 L6 37 L22 37 Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  LJ: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 4 Q16 14 18 24 Q16 32 6 36" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.10" strokeDasharray="3 2" />
    </svg>
  ),
  SS: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 6 L6 34 L16 34 Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  C0: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 Q28 8 30 20 Q28 32 6 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  SPI: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="4" y1="2" x2="4" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 3 Q32 6 30 20 Q32 34 4 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.2" />
      <line x1="4" y1="3" x2="20" y2="2" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1" />
    </svg>
  ),
  HG: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="8" y1="2" x2="8" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3 Q24 6 28 20 Q24 34 8 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.2" />
      <line x1="8" y1="3" x2="4" y2="6" stroke="currentColor" strokeWidth="1" />
      <line x1="8" y1="37" x2="4" y2="34" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  LG: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="8" y1="2" x2="8" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4 Q22 8 26 20 Q22 32 8 36" stroke="currentColor" strokeWidth="1.0" fill="currentColor" fillOpacity="0.10" strokeDasharray="3 2" />
      <line x1="8" y1="4" x2="4" y2="7" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  ),
};

/** Transition durations by sail pair (from game-balance.json). Default 180s. */
const TRANSITION_TIMES: Record<string, number> = {
  JIB_LJ: 120, LJ_JIB: 120,
  JIB_SS: 150, SS_JIB: 150,
  JIB_C0: 180, C0_JIB: 180,
  C0_SPI: 300, SPI_C0: 300,
  C0_HG: 240, HG_C0: 240,
  SPI_HG: 240, HG_SPI: 240,
  SPI_LG: 180, LG_SPI: 180,
  HG_LG: 180, LG_HG: 180,
  SS_C0: 180, C0_SS: 180,
  LJ_SS: 150, SS_LJ: 150,
  JIB_SPI: 360, SPI_JIB: 360,
  LJ_C0: 240, C0_LJ: 240,
};

function getTransitionDuration(from: SailId, to: SailId): number {
  return TRANSITION_TIMES[`${from}_${to}`] ?? 180;
}

const SAILS: { id: SailId; name: string }[] = [
  { id: 'JIB', name: 'Foc' },
  { id: 'LJ', name: 'Foc léger' },
  { id: 'SS', name: 'Trinquette' },
  { id: 'C0', name: 'Code 0' },
  { id: 'SPI', name: 'Spinnaker' },
  { id: 'HG', name: 'Gennaker lourd' },
  { id: 'LG', name: 'Gennaker léger' },
];

export default function SailPanel(): React.ReactElement {
  const sailState = useGameStore((s) => s.sail);
  const { currentSail, sailAuto, transitionStartMs, transitionEndMs } = sailState;
  const { twa, tws, boatClass } = useGameStore((s) => s.hud);
  const [candidateSail, setCandidateSail] = useState<SailId | null>(null);
  const [wasAuto, setWasAuto] = useState(false);
  const [polarReady, setPolarReady] = useState(false);

  // Load polar data for speed estimates
  useEffect(() => {
    loadPolar(boatClass).then(() => setPolarReady(true));
  }, [boatClass]);

  // Local 1s tick to update remaining display from timestamps
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTransitioning = transitionEndMs > 0 && now < transitionEndMs;

  // Polar data for per-sail speed estimates at current TWA/TWS
  const absTwa = Math.min(Math.abs(twa), 180);
  const polar = polarReady ? getCachedPolar(boatClass) : null;

  // Only show sails that the boat's polar actually defines. For classes
  // like CRUISER_RACER the polar only carries JIB + SPI — listing the full
  // 7-sail set here would dangle empty rows.
  const availableSails = polar
    ? SAILS.filter((s) => (s.id as string) in polar.speeds)
    : SAILS;

  useEffect(() => {
    if (!isTransitioning) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTransitioning]);

  const totalSec = transitionEndMs > transitionStartMs ? (transitionEndMs - transitionStartMs) / 1000 : 0;
  const remainingSec = isTransitioning ? Math.max(0, Math.ceil((transitionEndMs - now) / 1000)) : 0;
  const progressPct = totalSec > 0 ? (remainingSec / totalSec) * 100 : 0;

  const onSailClick = (id: SailId) => {
    if (id === currentSail || isTransitioning) return;
    setWasAuto(sailAuto);
    setCandidateSail(id);
    useGameStore.getState().setPreview({ sail: id });
  };

  const confirmSail = () => {
    if (!candidateSail) return;
    const duration = getTransitionDuration(currentSail, candidateSail);
    const startMs = Date.now();

    if (wasAuto) {
      sendOrder({ type: 'MODE', value: { auto: false } });
      useGameStore.getState().setSailOptimistic('sailAuto', false);
    }
    sendOrder({ type: 'SAIL', value: { sail: candidateSail } });
    useGameStore.getState().setOptimisticSailChange({
      currentSail: candidateSail,
      transitionStartMs: startMs,
      transitionEndMs: startMs + duration * 1000,
    });

    setNow(startMs);
    setCandidateSail(null);
    useGameStore.getState().setPreview({ sail: null });
  };

  const cancelSail = () => {
    setCandidateSail(null);
    useGameStore.getState().setPreview({ sail: null });
  };

  const toggleAuto = () => {
    const next = !sailAuto;
    sendOrder({ type: 'MODE', value: { auto: next } });
    useGameStore.getState().setSailOptimistic('sailAuto', next);

    // When switching TO auto, optimistically pick the best sail for current TWA/TWS
    // so the player sees the switch immediately without waiting for the next tick.
    if (next && polar) {
      const optimal = pickOptimalSail(polar, twa, tws);
      if (optimal !== currentSail) {
        const duration = getTransitionDuration(currentSail, optimal);
        const startMs = Date.now();
        useGameStore.getState().setOptimisticSailChange({
          currentSail: optimal,
          transitionStartMs: startMs,
          transitionEndMs: startMs + duration * 1000,
        });
      }
    }
  };

  return (
    <div>
      {/* Mode toggle */}
      <div className={styles.modeToggle}>
        <button type="button" className={`${styles.modeBtn} ${sailAuto ? styles.modeBtnActive : ''}`} onClick={() => { if (!sailAuto) toggleAuto(); }}>
          Auto
        </button>
        <button type="button" className={`${styles.modeBtn} ${!sailAuto ? styles.modeBtnActive : ''}`} onClick={() => { if (sailAuto) toggleAuto(); }}>
          Manuel
        </button>
      </div>

      {/* Sail list */}
      <div className={styles.sailList}>
        {availableSails.map((s) => {
          const isActive = s.id === currentSail;
          const isCandidate = s.id === candidateSail;
          const disabled = isTransitioning && !isActive;
          const estimatedBsp = polar ? getPolarSpeed(polar, s.id, absTwa, tws) : null;
          const inRange = estimatedBsp !== null && estimatedBsp > 0.5;
          return (
            <button
              key={s.id}
              type="button"
              className={`${styles.sailRow} ${isCandidate ? styles.sailRowCandidate : isActive ? styles.sailRowActive : ''} ${disabled ? styles.sailRowDisabled : ''}`}
              onClick={() => onSailClick(s.id)}
              disabled={disabled}
            >
              <div className={styles.sailRowIcon}>{SAIL_ICONS[s.id]}</div>
              <div className={styles.sailRowInfo}>
                <div className={styles.sailRowHeader}>
                  <span className={styles.sailRowName}>{s.id}</span>
                  <span className={styles.sailRowFullName}>{s.name}</span>
                  <span className={inRange ? styles.sailRowSpeed : styles.sailRowSpeedOff}>
                    {estimatedBsp !== null ? `${estimatedBsp.toFixed(3)} kn` : '—'}
                  </span>
                </div>
                {/* Transition progress bar — only on active sail during penalty */}
                {isActive && isTransitioning && (
                  <div className={styles.transitionWrap}>
                    <span className={styles.transitionLabel}>Manœuvre en cours · {remainingSec}s</span>
                    <div className={styles.transitionBar}>
                      <div
                        className={styles.transitionBarFill}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Confirm strip */}
      {candidateSail && (
        <div className={styles.confirmStrip}>
          <div className={styles.confirmIcon}>{SAIL_ICONS[candidateSail]}</div>
          <span className={styles.confirmText}>
            {currentSail} → <strong>{candidateSail}</strong>
          </span>
          <button type="button" className={styles.confirmCancel} onClick={cancelSail}>Annuler</button>
          <button type="button" className={styles.confirmOk} onClick={confirmSail}>Confirmer</button>
        </div>
      )}
    </div>
  );
}
