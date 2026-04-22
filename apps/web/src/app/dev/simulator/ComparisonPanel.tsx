'use client';
// apps/web/src/app/dev/simulator/ComparisonPanel.tsx
// Right-side panel showing per-boat live metrics and the Δ projection
// deviation for the primary boat.

import styles from './ComparisonPanel.module.css';
import type { SimBoatSetup, SimFleetState } from '@/lib/simulator/types';
import { boatColor } from './colors';

interface Props {
  boats: SimBoatSetup[];
  fleet: Record<string, SimFleetState>;
  primaryId: string | null;
  projectionDeviationNm: number | null;
}

export function ComparisonPanel({
  boats,
  fleet,
  primaryId,
  projectionDeviationNm,
}: Props) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>Comparaison live</div>

      {boats.length === 0 && (
        <div className={styles.empty}>Aucun bateau configuré</div>
      )}

      {boats.map((boat) => {
        const isPrimary = boat.id === primaryId;
        const s: SimFleetState | undefined = fleet[boat.id];
        const color = boatColor(boat.id, primaryId, boats.map((b) => b.id));

        return (
          <div
            key={boat.id}
            className={styles.card}
            style={{ borderLeftColor: color }}
          >
            <div className={styles.cardTitle}>
              <strong>{boat.name}</strong>
              {isPrimary && (
                <span className={styles.primaryBadge}>principal</span>
              )}
            </div>
            <div className={styles.cardMeta}>
              {boat.boatClass} · {s?.sail ?? boat.initialSail}
            </div>

            <table className={styles.metrics}>
              <tbody>
                <tr>
                  <td>BSP</td>
                  <td>{s ? `${s.bsp.toFixed(1)} kts` : '— kts'}</td>
                </tr>
                <tr>
                  <td>TWA</td>
                  <td>{s ? `${s.twa.toFixed(0)}°` : '—°'}</td>
                </tr>
                <tr>
                  <td>Distance</td>
                  <td>{s ? `${s.distanceNm.toFixed(1)} NM` : '0.0 NM'}</td>
                </tr>
                {isPrimary && (
                  <tr className={styles.deviationRow}>
                    <td>Δ projection</td>
                    <td>
                      {projectionDeviationNm !== null
                        ? `${projectionDeviationNm >= 0 ? '+' : ''}${projectionDeviationNm.toFixed(2)} NM`
                        : '— NM'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className={styles.wearBlock}>
              <WearBar label="Coque" value={s?.condition.hull ?? boat.initialCondition.hull} />
              <WearBar label="Gréement" value={s?.condition.rig ?? boat.initialCondition.rig} />
              <WearBar label="Voiles" value={s?.condition.sails ?? boat.initialCondition.sails} />
              <WearBar label="Électro" value={s?.condition.electronics ?? boat.initialCondition.electronics} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WearBar({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const barColor = v > 60 ? '#7cc9a5' : v > 30 ? '#c9a557' : '#d97070';
  return (
    <div className={styles.wearRow}>
      <span className={styles.wearLabel}>{label}</span>
      <div className={styles.wearTrack}>
        <div className={styles.wearFill} style={{ width: `${v}%`, background: barColor }} />
      </div>
      <span className={styles.wearValue}>{v.toFixed(0)}</span>
    </div>
  );
}
