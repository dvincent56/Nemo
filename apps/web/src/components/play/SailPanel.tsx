'use client';

import { useEffect, useRef, useState } from 'react';
import type { SailId } from '@nemo/shared-types';
import { sendOrder, useGameStore } from '@/lib/store';
import { loadPolar, getCachedPolar, getPolarSpeed } from '@/lib/polar';
import styles from './SailPanel.module.css';

/* ── Sail icon SVGs (vue de profil, mât à gauche) ── */
const SAIL_ICONS: Record<SailId, React.ReactElement> = {
  LW: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 4 Q18 12 20 22 Q18 30 6 36" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  JIB: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 L6 37 L22 37 Z" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  GEN: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 Q22 10 26 20 Q22 30 6 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
    </svg>
  ),
  C0: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="6" y1="2" x2="6" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 3 Q28 8 30 20 Q28 32 6 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.15" />
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
  SPI: (
    <svg viewBox="0 0 32 40" fill="none" className={styles.sailIcon}>
      <line x1="4" y1="2" x2="4" y2="38" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 3 Q32 6 30 20 Q32 34 4 37" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.2" />
      <line x1="4" y1="3" x2="20" y2="2" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 1" />
    </svg>
  ),
};

/** Transition durations by sail pair (from game-balance.json). Default 180s. */
const TRANSITION_TIMES: Record<string, number> = {
  GEN_SPI: 300, SPI_GEN: 300,
  C0_HG: 240, HG_C0: 240,
  JIB_GEN: 120, GEN_JIB: 120,
  C0_SPI: 360, SPI_C0: 360,
  LW_JIB: 180, JIB_LW: 180,
};

function getTransitionDuration(from: SailId, to: SailId): number {
  return TRANSITION_TIMES[`${from}_${to}`] ?? 180;
}

const SAILS: { id: SailId; name: string; twaMin: number; twaMax: number }[] = [
  { id: 'LW', name: 'Light Wind', twaMin: 0, twaMax: 60 },
  { id: 'JIB', name: 'Foc', twaMin: 30, twaMax: 100 },
  { id: 'GEN', name: 'Genoa', twaMin: 50, twaMax: 140 },
  { id: 'C0', name: 'Code 0', twaMin: 60, twaMax: 150 },
  { id: 'HG', name: 'Heavy Genoa', twaMin: 100, twaMax: 170 },
  { id: 'SPI', name: 'Spinnaker', twaMin: 120, twaMax: 180 },
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

  // Compute estimated speed per sail from polar + current TWA/TWS
  const absTwa = Math.min(Math.abs(twa), 180);
  const polar = polarReady ? getCachedPolar(boatClass) : null;
  const baseBsp = polar ? getPolarSpeed(polar, absTwa, tws) : null;

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
    if (wasAuto) {
      sendOrder({ type: 'MODE', value: { auto: false } });
      useGameStore.getState().setSail({ sailAuto: false });
    }
    sendOrder({ type: 'SAIL', value: { sail: candidateSail } });
    const duration = getTransitionDuration(currentSail, candidateSail);
    const startMs = Date.now();
    useGameStore.getState().setSail({
      currentSail: candidateSail,
      sailPending: null,
      sailAuto: false,
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
    sendOrder({ type: 'MODE', value: { auto: !sailAuto } });
    useGameStore.getState().toggleSailAuto();
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
        {SAILS.map((s) => {
          const isActive = s.id === currentSail;
          const isCandidate = s.id === candidateSail;
          const disabled = isTransitioning && !isActive;
          const inRange = absTwa >= s.twaMin && absTwa <= s.twaMax;
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
                    {baseBsp !== null ? `${baseBsp.toFixed(1)} kn` : '—'}
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
