'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SailId } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance/browser';
import { sendOrder, useGameStore } from '@/lib/store';
import { loadPolar, getCachedPolar, getPolarSpeed } from '@/lib/polar';
import { pickOptimalSail } from '@/lib/polar/pickOptimalSail';
import { predictAfterHdg } from '@/lib/optimistic/predictAfterHdg';
import { Check } from 'lucide-react';
import styles from './Compass.module.css';
import Tooltip from '@/components/ui/Tooltip';
import { isInVmgZone } from './compass/compassGeometry';
import CompassReadouts from './compass/CompassReadouts';
import CompassLockToggle from './compass/CompassLockToggle';
import CompassDial from './compass/CompassDial';

export default function Compass(): React.ReactElement {
  const t = useTranslations('play.compass');
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
  // Discriminator passed to <CompassReadouts> which owns the actual CSS classes.
  // 'live' (vert) — voile optimale ou quasi ; 'warn' (orange) — une meilleure
  // voile existe ; 'danger' (rouge) — voile fortement sous-optimale.
  const bspColorClass: 'live' | 'warn' | 'danger' =
    bspRatio >= 0.95 ? 'live'
      : bspRatio >= 0.80 ? 'warn'
      : 'danger';

  // ── Hint "la validation va déclencher une manœuvre" ─────────────────
  // Affiché pendant l'édition de cap quand la validation provoquera un coût
  // visible : virement (TWA change de bord, |newTwa|<90), empannage (idem
  // mais |newTwa|>90), ou changement de voile auto (nouveau TWA → autre voile
  // optimale). Si plusieurs s'appliquent, on affiche le plus contraignant :
  // empannage > virement > changement de voile (durées & pénalités de vitesse
  // décroissantes). Le message est rendu en absolute au-dessus du compass
  // pour ne pas modifier sa hauteur quand il apparaît/disparaît.
  let pendingHint: { label: string; className: 'hintGybe' | 'hintTack' | 'hintSail' } | null = null;
  if (applyActive && polar && boatClass) {
    const sameSign = Math.sign(displayTwa) === Math.sign(twa) || twa === 0;
    const isManeuver = !sameSign && displayTwa !== 0 && twa !== 0;
    const isTack = isManeuver && Math.abs(displayTwa) < 90;
    const isGybe = isManeuver && Math.abs(displayTwa) >= 90;

    if (isGybe) {
      const dur = GameBalance.maneuvers?.gybe?.durationSec?.[boatClass] ?? 120;
      const pct = Math.round((1 - (GameBalance.maneuvers?.gybe?.speedFactor ?? 0.55)) * 100);
      pendingHint = { label: t('hints.gybe', { pct, dur }), className: 'hintGybe' };
    } else if (isTack) {
      const dur = GameBalance.maneuvers?.tack?.durationSec?.[boatClass] ?? 90;
      const pct = Math.round((1 - (GameBalance.maneuvers?.tack?.speedFactor ?? 0.60)) * 100);
      pendingHint = { label: t('hints.tack', { pct, dur }), className: 'hintTack' };
    } else if (sailAuto) {
      const optimal = pickOptimalSail(polar, displayTwa, tws);
      if (optimal !== currentSail) {
        const key = `${currentSail}_${optimal}`;
        const dur = (GameBalance.sails?.transitionTimes as Record<string, number> | undefined)?.[key] ?? 180;
        const pct = Math.round((1 - (GameBalance.sails?.transitionPenalty ?? 0.7)) * 100);
        pendingHint = { label: t('hints.sail', { from: currentSail, to: optimal, pct, dur }), className: 'hintSail' };
      }
    }
  }

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

  // ── Apply heading / lock state ──
  // A single validation path: commits both heading changes AND lock toggles
  // so the player can compose the two (e.g. drag + lock) then validate once.
  // Orders are rounded to integer degrees to match what the UI displays —
  // otherwise TWA derived from (hdg − twd) carries the fractional TWD and
  // the engine ends up computing on e.g. 169.70° when the player saw 170°.
  const apply = useCallback(() => {
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
  }, [applyActive, twaLocked, targetHdg, twd, hdg, lockedTwa, twa, tws, currentSail, sailAuto, bspBaseMultiplier, transitionEndMs, maneuverEndMs, maneuverKind, polar, boatClass]);

  // ── Cancel editing ──
  // The dial's sync `useEffect` watches [value, ghostValue] and re-applies
  // the SVG transforms on the next render, so resetting `targetHdg` to null
  // (which makes displayHdg revert to `hdg` and the ghost prop go back to
  // matching `value`) is enough to visually snap the boat back. No direct
  // SVG mutation needed here anymore.
  const cancelEdit = useCallback(() => {
    setTargetHdg(null);
    if (committedTwaLock !== null) {
      setTwaLocked(true);
      setLockedTwa(committedTwaLock);
      useGameStore.getState().setPreview({ hdg: null, twaLocked: true, lockedTwa: committedTwaLock });
    } else {
      setTwaLocked(false);
      useGameStore.getState().setPreview({ hdg: null, twaLocked: false });
    }
  }, [committedTwaLock]);

  // ── Toggle TWA lock (preview only) ──
  // Toggling the lock button never commits an order by itself — it only
  // updates the local preview so the projection line reflects the new mode.
  // The player must click Apply (check button) or hit Entrée to validate.
  // If the player is currently previewing a heading (compass drag), we lock
  // on THAT preview's TWA; otherwise we lock on the current live TWA.
  const toggleTwaLock = useCallback(() => {
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
  }, [twaLocked, targetHdg, twd, twa]);

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
  }, [applyActive, apply, cancelEdit, toggleTwaLock]);

  return (
    <>
      <div className={`${styles.wrapper} ${vmgGlow ? styles.vmgGlow : ''}`}>
        {/* Readouts (3 cols Vitesse/Cap/TWA) + manoeuvre hint above. The
            wrapper provides position: relative so the absolute hint anchors
            correctly; CompassReadouts emits both as a fragment. */}
        <CompassReadouts
          headingDeg={displayHdg}
          twaDeg={displayTwa}
          bspKn={displayBsp}
          vmgGlow={vmgGlow}
          bspColorClass={bspColorClass}
          pendingHint={pendingHint ?? undefined}
        />

        {/* Compass cadran — extracted primitive. The inline onChange wraps
            the dial's drag/wheel callback so we update BOTH the local
            targetHdg state (drives applyActive, displayHdg, hint) AND the
            store preview (drives the projection line on the map). Dropping
            either side breaks live drag feedback. */}
        <CompassDial
          value={displayHdg}
          onChange={(h) => {
            setTargetHdg(h);
            useGameStore.getState().setPreview({ hdg: h });
          }}
          windDir={twd}
          ghostValue={hdg}
          tws={tws}
        />

        {/* Action buttons */}
        <div className={styles.actions}>
          <Tooltip text={twaLocked ? t('tooltips.lockedOn') : t('tooltips.lockedOff')} shortcut={t('tooltips.lockedShortcut')} position="bottom">
            <CompassLockToggle locked={twaLocked} onToggle={toggleTwaLock} />
          </Tooltip>
          <Tooltip text={t('tooltips.apply')} shortcut={t('tooltips.applyShortcut')} position="bottom">
            <button
              type="button"
              className={`${styles.actionBtn} ${applyActive ? styles.applyActive : styles.applyInactive}`}
              onClick={apply}
            >
              <Check size={14} strokeWidth={3} />
              <span>{t('actions.validate')}</span>
            </button>
          </Tooltip>
          <Tooltip text={t('tooltips.cancel')} shortcut={t('tooltips.cancelShortcut')} position="bottom">
            <button
              type="button"
              className={`${styles.actionBtn} ${applyActive ? styles.cancelActive : styles.cancelInactive}`}
              onClick={cancelEdit}
              disabled={!applyActive}
              aria-label={t('actions.cancelAria')}
            >
              <span className={styles.cancelX} aria-hidden="true">×</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
}
