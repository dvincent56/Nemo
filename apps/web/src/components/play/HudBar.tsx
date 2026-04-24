'use client';

import { memo } from 'react';
import Link from 'next/link';
import type { SailId } from '@nemo/shared-types';
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

function HudBarInner(): React.ReactElement {
  const hud = useGameStore((s) => s.hud);
  const sail = useGameStore((s) => s.sail);
  const now = Date.now();

  // BSP efficiency ratio: compare real BSP to the best polar speed achievable
  // at the current TWA/TWS across all sails. Drops hard during any maneuver
  // because `bsp` already carries the transition / tack / gybe penalty —
  // giving the player a visible cue that the number is depressed on purpose.
  const polar = getCachedPolar(hud.boatClass);
  const bestPolarAtTwa = polar
    ? Math.max(...(Object.keys(polar.speeds) as SailId[]).map((s) =>
        getPolarSpeed(polar, s, hud.twa, hud.tws)))
    : 0;
  const bspRatio = bestPolarAtTwa > 0 ? hud.bsp / bestPolarAtTwa : 1;
  const bspColor = bspRatio >= 0.95 ? styles.live
    : bspRatio >= 0.80 ? styles.warn
    : styles.danger;

  // Active maneuver badge — explains any BSP suppression the player sees.
  // Priority: gybe > tack > sail transition (matches engine penalty ordering).
  const tackOrGybe = sail.maneuverKind !== 0 && now < sail.maneuverEndMs;
  const sailTransitioning = sail.transitionEndMs > 0 && now < sail.transitionEndMs;
  let maneuverBadge: { label: string; className: string } | null = null;
  if (tackOrGybe && sail.maneuverKind === 2) {
    maneuverBadge = { label: 'Empannage', className: styles.maneuverBadgeGybe! };
  } else if (tackOrGybe && sail.maneuverKind === 1) {
    maneuverBadge = { label: 'Virement', className: styles.maneuverBadgeTack! };
  } else if (sailTransitioning) {
    maneuverBadge = { label: 'Chgt voile', className: styles.maneuverBadgeSail! };
  }

  const trendClass = hud.rankTrend > 0 ? styles.trendUp : hud.rankTrend < 0 ? styles.trendDown : '';
  const trendText = hud.rankTrend > 0 ? `▲ ${hud.rankTrend}` : hud.rankTrend < 0 ? `▼ ${Math.abs(hud.rankTrend)}` : '';

  return (
    <div className={styles.bar} role="toolbar" aria-label="Tableau de bord course">
      {/* Brand */}
      <Link href="/" className={styles.brand}>
        NE<span className={styles.brandAccent}>M</span>O
      </Link>

      {/* Rank hero */}
      <div className={styles.rankHero} aria-label="Rang actuel">
        <span className={styles.rankLabel}>Rang</span>
        <span className={styles.rankValue}>
          {hud.rank || '—'}
          <span className={styles.rankTotal}>/{hud.totalParticipants || '—'}</span>
        </span>
        {trendText && <span className={`${styles.rankTrend} ${trendClass}`}>{trendText}</span>}
      </div>

      {/* Stats */}
      <div className={styles.stats}>
        <Tooltip text="Vitesse réelle du bateau — pénalités de manœuvre incluses" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>BSP</span>
            <span className={`${styles.statValue} ${bspColor}`}>
              {hud.bsp.toFixed(2)} <small>nds</small>
              {maneuverBadge && (
                <span className={`${styles.maneuverBadge} ${maneuverBadge.className}`}>
                  {maneuverBadge.label}
                </span>
              )}
            </span>
          </div>
        </Tooltip>
        <Tooltip text="Vitesse réelle du vent" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>TWS</span>
            <span className={styles.statValue}>{hud.tws.toFixed(3)} <small>nds</small></span>
          </div>
        </Tooltip>
        <Tooltip text="Direction du vent (d'où il vient)" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>TWD</span>
            <span className={styles.statValue}>{hud.twd.toFixed(3)}°</span>
          </div>
        </Tooltip>
        <Tooltip text="Angle du vent / bateau" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>TWA</span>
            <span className={styles.statValue}>{Math.round(hud.twa)}°</span>
          </div>
        </Tooltip>
        <Tooltip text="Cap du bateau" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>HDG</span>
            <span className={styles.statValue}>{Math.round(hud.hdg)}°</span>
          </div>
        </Tooltip>
        <Tooltip text="Vitesse vers le waypoint" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>VMG</span>
            <span className={`${styles.statValue} ${styles.gold}`}>{hud.vmg.toFixed(3)} <small>nds</small></span>
          </div>
        </Tooltip>
        <Tooltip text="Distance restante" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>DTF</span>
            <span className={styles.statValue}>{Math.round(hud.dtf).toLocaleString('fr-FR')} <small>NM</small></span>
          </div>
        </Tooltip>
        <Tooltip
          text="Zone de recouvrement — en voile auto uniquement, garde la voile active quand une autre serait marginalement plus rapide (≤ +1.4%) et lui applique la BSP de l'optimale pour éviter les allers-retours."
          position="bottom"
        >
          <div className={styles.stat}>
            <span className={styles.statLabel}>Factor</span>
            <span className={styles.statValue} style={{ color: factorColor(hud.overlapFactor) }}>
              {`+${((hud.overlapFactor - 1) * 100).toFixed(2)}%`}
            </span>
          </div>
        </Tooltip>

        {/* Wear indicator — tooltip shows per-component breakdown */}
        <Tooltip
          position="bottom"
          delay={200}
          content={
            <div className={styles.wearBreakdown}>
              <p className={styles.wearExplain}>
                Un bateau usé navigue plus lentement. Évitez les conditions extrêmes
                pour préserver vos performances.
              </p>
              {(['hull', 'rig', 'sails', 'electronics'] as const).map((part) => (
                <div key={part} className={styles.wearRow}>
                  <span>{part === 'hull' ? 'Coque' : part === 'rig' ? 'Gréement' : part === 'sails' ? 'Voiles' : 'Électronique'}</span>
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
                Pénalité de vitesse : <strong>−{hud.speedPenaltyPct.toFixed(1)}%</strong>
              </p>
            </div>
          }
        >
          <div className={styles.wearStat} tabIndex={0} aria-label="Usure du bateau">
            <span className={styles.statLabel}>⚓ Usure</span>
            <span className={`${styles.statValue}`} style={{ color: wearColor(hud.wearGlobal) }}>
              {Math.round(hud.wearGlobal)}%
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Quit button */}
      <div className={styles.end}>
        <Tooltip text="Quitter et revenir aux courses" position="bottom">
          <Link href="/races" className={styles.quit}>
            ← Quitter
          </Link>
        </Tooltip>
      </div>
    </div>
  );
}

export default memo(HudBarInner);
