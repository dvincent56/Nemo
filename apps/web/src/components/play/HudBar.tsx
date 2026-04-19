'use client';

import { memo } from 'react';
import Link from 'next/link';
import { useGameStore } from '@/lib/store';
import Tooltip from '@/components/ui/Tooltip';
import styles from './HudBar.module.css';

function wearColor(value: number): string {
  if (value >= 70) return '#6cd28a';
  if (value >= 40) return '#f0b96b';
  return '#9e2a2a';
}

function HudBarInner(): React.ReactElement {
  const hud = useGameStore((s) => s.hud);

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
        <Tooltip text="Vitesse du bateau sur l'eau" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>BSP</span>
            <span className={`${styles.statValue} ${styles.live}`}>{hud.bsp.toFixed(1)} <small>nds</small></span>
          </div>
        </Tooltip>
        <Tooltip text="Vitesse réelle du vent" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>TWS</span>
            <span className={styles.statValue}>{hud.tws.toFixed(1)} <small>nds</small></span>
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
            <span className={`${styles.statValue} ${styles.gold}`}>{hud.vmg.toFixed(1)} <small>nds</small></span>
          </div>
        </Tooltip>
        <Tooltip text="Distance restante" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>DTF</span>
            <span className={styles.statValue}>{Math.round(hud.dtf).toLocaleString('fr-FR')} <small>NM</small></span>
          </div>
        </Tooltip>
        <Tooltip text="Facteur de performance" position="bottom">
          <div className={styles.stat}>
            <span className={styles.statLabel}>Factor</span>
            <span className={`${styles.statValue} ${hud.overlapFactor < 1 ? styles.warn : ''}`}>
              {hud.overlapFactor.toFixed(2)}×
            </span>
          </div>
        </Tooltip>

        {/* Wear indicator with hover tooltip */}
        <Tooltip text="État général du bateau" position="bottom">
          <div className={styles.wearStat} tabIndex={0} aria-label="Usure du bateau">
            <span className={styles.statLabel}>⚓ Usure</span>
            <span className={`${styles.statValue}`} style={{ color: wearColor(hud.wearGlobal) }}>
              {Math.round(hud.wearGlobal)}%
            </span>
            <div className={styles.wearTooltip}>
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
            </div>
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
