'use client';

import { memo, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { SailId } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance/browser';
import { useGameStore } from '@/lib/store';
import { getCachedPolar, getPolarSpeed } from '@/lib/polar';
import Tooltip from '@/components/ui/Tooltip';
import styles from './HudBar.module.css';

function wearColor(value: number): string {
  if (value >= 70) return '#6cd28a';
  if (value >= 40) return '#f0b96b';
  return '#9e2a2a';
}

/** Factor colour. Le facteur = (BSP appliquée / BSP voile active), uniquement
 *  > 1 dans la zone de recouvrement auto (borné à `sails.overlapThreshold`,
 *  ≈ 1.014). À 1.0 = pas de bonus ; tout entre 1.0 et cap = bonus en cours. */
function factorColor(f: number): string {
  if (f <= 1.0001) return '#f5f0e8';
  return '#c9a227';
}

/** Ray-casting point-in-polygon — ring coords are [lon, lat] GeoJSON pairs */
function pointInPolygon(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const xi = pi[0], yi = pi[1];
    const xj = pj[0], yj = pj[1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function HudBarInner(): React.ReactElement {
  const t = useTranslations('play.hud');
  const hud = useGameStore((s) => s.hud);
  const sail = useGameStore((s) => s.sail);
  const zones = useGameStore((s) => s.zones);
  const [now, setNow] = useState(() => Date.now());

  const tackOrGybe = sail.maneuverKind !== 0 && now < sail.maneuverEndMs;
  // "transitioning" = any window where transition is declared (includes server-clock-ahead pending phase)
  const sailTransitioning = sail.transitionEndMs > 0 && now < sail.transitionEndMs;
  // "active" = transition has actually started from client's clock perspective — apply BSP penalty
  const sailTransitionActive = sail.transitionEndMs > 0 && now >= sail.transitionStartMs && now < sail.transitionEndMs;

  // Live countdown — runs only during active maneuver/transition windows to
  // avoid continuous re-renders during normal navigation.
  useEffect(() => {
    if (!tackOrGybe && !sailTransitioning) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [tackOrGybe, sailTransitioning]);

  const polar = hud.boatClass ? getCachedPolar(hud.boatClass) : null;
  const bestPolarAtTwa = polar
    ? Math.max(...(Object.keys(polar.speeds) as SailId[]).map((s) =>
        getPolarSpeed(polar, s, hud.twa, hud.tws)))
    : 0;

  // During a maneuver/transition the server hasn't ticked yet, but the client
  // knows the penalty factor (same game-balance), so simulate the reduced BSP
  // immediately — same computation as the engine, no waiting for a tick.
  const polarBspCurrentSail = polar
    ? getPolarSpeed(polar, sail.currentSail, hud.twa, hud.tws)
    : 0;
  let displayBsp = hud.bsp;
  if (polarBspCurrentSail > 0) {
    if (tackOrGybe) {
      const factor = sail.maneuverKind === 2
        ? (GameBalance.maneuvers?.gybe?.speedFactor ?? 0.55)
        : (GameBalance.maneuvers?.tack?.speedFactor ?? 0.60);
      displayBsp = polarBspCurrentSail * factor;
    } else if (sailTransitionActive) {
      displayBsp = polarBspCurrentSail * (GameBalance.sails?.transitionPenalty ?? 0.7);
    }
  }

  const bspRatio = bestPolarAtTwa > 0 ? displayBsp / bestPolarAtTwa : 1;
  const bspColor = bspRatio >= 0.95 ? styles.live
    : bspRatio >= 0.80 ? styles.warn
    : styles.danger;

  // Penalty dot — a small coloured circle next to BSP with a descriptive tooltip.
  // Priority: gybe > tack > sail transition > zone (matches engine penalty ordering).
  let penaltyDot: { tooltip: string; dotClass: string } | null = null;
  if (tackOrGybe && sail.maneuverKind === 2) {
    penaltyDot = { tooltip: t('penalty.gybe'), dotClass: styles.maneuverDotGybe! };
  } else if (tackOrGybe && sail.maneuverKind === 1) {
    penaltyDot = { tooltip: t('penalty.tack'), dotClass: styles.maneuverDotTack! };
  } else if (sailTransitioning) {
    penaltyDot = { tooltip: t('penalty.sail'), dotClass: styles.maneuverDotSail! };
  } else if (hud.lat || hud.lon) {
    const activeZone = zones.find((z) => {
      const ring = z.geometry.coordinates[0];
      return ring !== undefined && (z.speedMultiplier ?? 1) < 1 &&
        pointInPolygon(hud.lat, hud.lon, ring);
    });
    if (activeZone) {
      const pct = Math.round((1 - (activeZone.speedMultiplier ?? 1)) * 100);
      penaltyDot = { tooltip: t('penalty.zone', { pct }), dotClass: styles.maneuverDotZone! };
    }
  }

  const trendClass = hud.rankTrend > 0 ? styles.trendUp : hud.rankTrend < 0 ? styles.trendDown : '';
  const trendText = hud.rankTrend > 0 ? `▲ ${hud.rankTrend}` : hud.rankTrend < 0 ? `▼ ${Math.abs(hud.rankTrend)}` : '';

  return (
    <div className={styles.bar} role="toolbar" aria-label={t('ariaToolbar')}>
      {/* Brand */}
      <Link href="/" className={styles.brand}>
        NE<span className={styles.brandAccent}>M</span>O
      </Link>

      {/* Rank hero */}
      <div className={styles.rankHero} aria-label={t('ariaRank')}>
        <span className={styles.rankLabel}>{t('rankLabel')}</span>
        <span className={styles.rankValue}>
          {hud.rank || '—'}
          <span className={styles.rankTotal}>/{hud.totalParticipants || '—'}</span>
        </span>
        {trendText && <span className={`${styles.rankTrend} ${trendClass}`}>{trendText}</span>}
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <Tooltip
          text={penaltyDot
            ? t('tooltips.bspWithPenalty', { penalty: penaltyDot.tooltip })
            : t('tooltips.bspBase')}
          position="bottom"
        >
          <div className={styles.stat}>
            <span className={styles.statLabel}>
              BSP
              {penaltyDot && (
                <span className={`${styles.maneuverDot} ${penaltyDot.dotClass}`} />
              )}
            </span>
            <span className={`${styles.statValue} ${bspColor}`}>
              {displayBsp.toFixed(2)} <small>nds</small>
            </span>
          </div>
        </Tooltip>
        <Tooltip text={t('tooltips.tws')} position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>TWS</span>
            <span className={styles.statValue}>{hud.tws.toFixed(1)} <small>nds</small></span>
          </div>
        </Tooltip>
        <Tooltip text={t('tooltips.twd')} position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>TWD</span>
            <span className={styles.statValue}>{Math.round(hud.twd)}°</span>
          </div>
        </Tooltip>
        <Tooltip text={t('tooltips.twa')} position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>TWA</span>
            <span className={styles.statValue}>{Math.round(hud.twa)}°</span>
          </div>
        </Tooltip>
        <Tooltip text={t('tooltips.hdg')} position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>HDG</span>
            <span className={styles.statValue}>{Math.round(hud.hdg)}°</span>
          </div>
        </Tooltip>
        <Tooltip text={t('tooltips.vmg')} position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>VMG</span>
            <span className={`${styles.statValue} ${styles.gold}`}>{hud.vmg.toFixed(3)} <small>nds</small></span>
          </div>
        </Tooltip>
        <Tooltip text={t('tooltips.dtf')} position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>DTF</span>
            <span className={styles.statValue}>{Math.round(hud.dtf).toLocaleString('fr-FR')} <small>NM</small></span>
          </div>
        </Tooltip>
        <Tooltip
          text={t('tooltips.factor')}
          position="bottom"
        >
          <div className={styles.stat}>
            <span className={styles.statLabel}>Factor</span>
            <span className={styles.statValue} style={{ color: factorColor(hud.overlapFactor) }}>
              +{((hud.overlapFactor - 1) * 100).toFixed(2)}%
            </span>
          </div>
        </Tooltip>

        {/* Wear indicator — tooltip shows per-component breakdown */}
        <Tooltip
          position="bottom"
          delay={200}
          content={
            <div className={styles.wearBreakdown}>
              <p className={styles.wearExplain}>{t('wear.explain')}</p>
              {(['hull', 'rig', 'sails', 'electronics'] as const).map((part) => (
                <div key={part} className={styles.wearRow}>
                  <span>{t(`wear.parts.${part}`)}</span>
                  <div className={styles.wearBarBg}>
                    <div
                      className={styles.wearBarFill}
                      style={{
                        width: `${hud.wearDetail[part]}%`,
                        background: wearColor(hud.wearDetail[part]),
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className={styles.wearPenalty}>
                {t('wear.penaltyLabel')} <strong>−{hud.speedPenaltyPct.toFixed(1)}%</strong>
              </p>
            </div>
          }
        >
          <div className={styles.wearStat} tabIndex={0} aria-label={t('wear.ariaLabel')}>
            <span className={styles.statLabel}>{t('wear.label')}</span>
            <span className={`${styles.statValue}`} style={{ color: wearColor(hud.wearGlobal) }}>
              {Math.round(hud.wearGlobal)}%
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Quit button */}
      <div className={styles.end}>
        <Tooltip text={t('tooltips.quit')} position="bottom">
          <Link href="/races" className={styles.quit}>
            {t('quit')}
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}

export default memo(HudBarInner);
