'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Polar, SailId } from '@nemo/shared-types';
import { sendOrder, useGameStore } from '@/lib/store';
import { loadPolar, getCachedPolar, getPolarSpeed } from '@/lib/polar';
import { pickOptimalSail } from '@/lib/polar/pickOptimalSail';
import { SAIL_ICONS, SAIL_DEFS } from '@/lib/sails/icons';
import {
  getTransitionDuration,
  getMaxTransitionSec,
} from '@nemo/game-engine-core/browser';
import styles from './SailPanel.module.css';

export default function SailPanel(): React.ReactElement {
  const t = useTranslations('play.sailPanel');
  const sailState = useGameStore((s) => s.sail);
  const { currentSail, sailAuto, transitionStartMs, transitionEndMs } = sailState;
  const { twa, tws, boatClass, bspBaseMultiplier } = useGameStore((s) => s.hud);
  const programmedSails = useGameStore((s) => s.prog.committed.sailOrders);
  const [candidateSail, setCandidateSail] = useState<SailId | null>(null);
  const [wasAuto, setWasAuto] = useState(false);
  const [polarReady, setPolarReady] = useState(() => !!boatClass && !!getCachedPolar(boatClass));

  useEffect(() => {
    if (!boatClass) return;
    if (getCachedPolar(boatClass)) { setPolarReady(true); return; }
    loadPolar(boatClass).then(() => setPolarReady(true)).catch(() => {});
  }, [boatClass]);

  // Local 1s tick to update remaining display from timestamps
  const [now, setNow] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTransitioning = transitionEndMs > 0 && now < transitionEndMs;

  // Polar data for per-sail speed estimates at current TWA/TWS
  const absTwa = Math.min(Math.abs(twa), 180);
  const polar = polarReady && boatClass ? getCachedPolar(boatClass) : null;

  const availableSails = SAIL_DEFS;

  useEffect(() => {
    if (!isTransitioning) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTransitioning]);

  // Programmed-sail lockout — when a committed AT_TIME manual SAIL order
  // sits within ±getMaxTransitionSec() of `now`, the UI refuses any sail
  // change so the user can't fight their own queue. Mirrors the engine's
  // `suppressAutoSwitch` window in `tick.ts`. AT_WAYPOINT triggers aren't
  // included — their effective time depends on routing dynamics, not a
  // wall-clock anchor.
  const lockoutOrder = (() => {
    const halfWindowMs = getMaxTransitionSec() * 1000;
    let best: { time: number; absDelta: number } | null = null;
    for (const o of programmedSails) {
      if (o.action.auto) continue;
      if (o.trigger.type !== 'AT_TIME') continue;
      const delta = o.trigger.time * 1000 - now;
      const abs = Math.abs(delta);
      if (abs > halfWindowMs) continue;
      if (best === null || abs < best.absDelta) {
        best = { time: o.trigger.time, absDelta: abs };
      }
    }
    return best;
  })();
  const isLockedByProg = lockoutOrder !== null;

  // SailPanel needs a 1Hz tick whenever the lockout window is active — the
  // user must see the warning persist while `now` slides inside ±X of the
  // programmed order. The existing transition-only tick stops as soon as the
  // current transition ends, so a separate effect handles the lockout case.
  useEffect(() => {
    if (!isLockedByProg) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLockedByProg]);

  const totalSec = transitionEndMs > transitionStartMs ? (transitionEndMs - transitionStartMs) / 1000 : 0;
  // Clamp to totalSec: when transitionStartMs > now (server clock ahead of client), the raw
  // remaining exceeds the total duration — cap it so the bar stays at 100% until the server's
  // start time is reached, then counts down normally.
  const remainingRaw = isTransitioning ? Math.max(0, Math.ceil((transitionEndMs - now) / 1000)) : 0;
  const remainingSec = Math.min(remainingRaw, totalSec);
  const progressPct = totalSec > 0 ? Math.min(100, (remainingSec / totalSec) * 100) : 0;

  const onSailClick = (id: SailId) => {
    if (id === currentSail || isTransitioning || isLockedByProg) return;
    if (sailAuto) {
      // In auto mode: switch sail immediately (no confirm step), revert to manual.
      sendOrder({ type: 'MODE', value: { auto: false } });
      useGameStore.getState().setSailOptimistic('sailAuto', false);
      sendOrder({ type: 'SAIL', value: { sail: id } });
      const duration = getTransitionDuration(currentSail, id);
      const startMs = Date.now();
      useGameStore.getState().setOptimisticSailChange({
        currentSail: id,
        transitionStartMs: startMs,
        transitionEndMs: startMs + duration * 1000,
      });
      setNow(startMs);
      useGameStore.getState().setPreview({ sail: null });
      return;
    }
    setWasAuto(false);
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
    if (isLockedByProg) return;
    const next = !sailAuto;
    sendOrder({ type: 'MODE', value: { auto: next } });
    useGameStore.getState().setSailOptimistic('sailAuto', next);

    if (!next) return;

    const applyOptimalSail = (p: Polar) => {
      const optimal = pickOptimalSail(p, twa, tws);
      if (optimal === currentSail) return;
      const duration = getTransitionDuration(currentSail, optimal);
      const startMs = Date.now();
      useGameStore.getState().setOptimisticSailChange({
        currentSail: optimal,
        transitionStartMs: startMs,
        transitionEndMs: startMs + duration * 1000,
      });
      setNow(startMs);
    };

    if (polar) {
      applyOptimalSail(polar);
    } else {
      if (boatClass) loadPolar(boatClass).then((p) => applyOptimalSail(p)).catch(() => {});
    }
  };

  return (
    <div>
      {isLockedByProg && lockoutOrder && (
        <div className={styles.lockoutBanner} role="status">
          {t('lockoutBanner')}
        </div>
      )}

      {/* Mode toggle */}
      <div className={styles.modeToggle}>
        <button
          type="button"
          className={`${styles.modeBtn} ${sailAuto ? styles.modeBtnActive : ''}`}
          onClick={() => { if (!sailAuto) toggleAuto(); }}
          disabled={isLockedByProg}
        >
          {t('modeAuto')}
        </button>
        <button
          type="button"
          className={`${styles.modeBtn} ${!sailAuto ? styles.modeBtnActive : ''}`}
          onClick={() => { if (sailAuto) toggleAuto(); }}
          disabled={isLockedByProg}
        >
          {t('modeManual')}
        </button>
      </div>

      {/* Sail list */}
      <div className={styles.sailList}>
        {availableSails.map((s) => {
          const isActive = s.id === currentSail;
          const isCandidate = s.id === candidateSail;
          const disabled = (isTransitioning && !isActive) || (isLockedByProg && !isActive);
          // Apply bspBaseMultiplier (wear + upgrades + swell) so per-sail speed
          // reflects actual boat performance, not raw polar.
          const estimatedBsp = polar
            ? getPolarSpeed(polar, s.id, absTwa, tws) * bspBaseMultiplier
            : null;
          const inRange = estimatedBsp !== null && estimatedBsp > 0.1;
          const speedLabel = inRange ? `${estimatedBsp!.toFixed(2)} kn` : '—';
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
                    {speedLabel}
                  </span>
                </div>
                {/* Transition progress bar — only on active sail during penalty */}
                {isActive && isTransitioning && (
                  <div className={styles.transitionWrap}>
                    <span className={styles.transitionLabel}>{t('transitionInProgress', { sec: remainingSec })}</span>
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
          <button type="button" className={styles.confirmCancel} onClick={cancelSail}>{t('cancel')}</button>
          <button type="button" className={styles.confirmOk} onClick={confirmSail}>{t('confirm')}</button>
        </div>
      )}
    </div>
  );
}
