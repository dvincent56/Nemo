'use client';
// apps/web/src/app/dev/simulator/SetupPanel.tsx

import type { SimBoatSetup } from '@/lib/simulator/types';
import type { BoatClass } from '@nemo/shared-types';
import styles from './SetupPanel.module.css';

// ── Labels ──────────────────────────────────────────────────────────────────

const CLASS_LABELS: Record<BoatClass, string> = {
  CRUISER_RACER: 'Cruiser-Racer',
  FIGARO: 'Figaro 3',
  CLASS40: 'Class40',
  OCEAN_FIFTY: 'Ocean Fifty',
  IMOCA60: 'IMOCA 60',
  ULTIM: 'Ultim',
};

const SLOT_LABELS: Record<string, string> = {
  HULL: 'Coque',
  MAST: 'Mât',
  SAILS: 'Voiles',
  FOILS: 'Foils',
  KEEL: 'Quille',
  ELECTRONICS: 'Électronique',
  REINFORCEMENT: 'Renforcement',
};

const TIER_SHORT: Record<string, string> = {
  SERIE: 'I',
  BRONZE: 'II',
  SILVER: 'III',
  GOLD: 'IV',
  PROTO: 'V',
};

// ── Props ────────────────────────────────────────────────────────────────────

interface SetupPanelProps {
  boats: SimBoatSetup[];
  primaryId: string | null;
  locked: boolean;
  onAddBoat(): void;
  onEditBoat(id: string): void;
  onDeleteBoat(id: string): void;
  onSetPrimary(id: string): void;
}

// ── Loadout summary ──────────────────────────────────────────────────────────

function buildLoadoutSummary(loadout: SimBoatSetup['loadout']): string {
  if (!loadout || !loadout.bySlot || loadout.bySlot.size === 0) return 'Aucun upgrade';

  const parts: string[] = [];
  for (const [slot, item] of loadout.bySlot) {
    if (item.tier === 'SERIE') continue; // skip base items
    const slotLabel = SLOT_LABELS[slot] ?? slot;
    const tierLabel = TIER_SHORT[item.tier] ?? item.tier;
    parts.push(`${slotLabel} ${tierLabel}`);
    if (parts.length >= 3) break;
  }
  return parts.length > 0 ? parts.join(' · ') : 'Aucun upgrade';
}

// ── Component ────────────────────────────────────────────────────────────────

export function SetupPanel({
  boats,
  primaryId,
  locked,
  onAddBoat,
  onEditBoat,
  onDeleteBoat,
  onSetPrimary,
}: SetupPanelProps) {
  // ── Locked mode ──────────────────────────────────────────────────────────
  if (locked) {
    return (
      <div className={styles.panel}>
        <div className={styles.lockedHeader}>
          <p className={styles.lockedTitle}>{boats.length} bateau{boats.length !== 1 ? 'x' : ''} en course</p>
          <p className={styles.lockedNote}>Setup verrouillé</p>
        </div>
        {/* Task 15: mount <OrderHistory> + <OrderInput> into this region */}
        <div className={styles.orderSlot}></div>
      </div>
    );
  }

  // ── Unlocked mode ────────────────────────────────────────────────────────
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <p className={styles.headerTitle}>Configuration</p>
        <p className={styles.headerCount}>Bateaux ({boats.length}/4)</p>
      </div>

      <div className={styles.boatList}>
        {boats.length === 0 && (
          <p className={styles.empty}>Aucun bateau — ajoutez-en un pour démarrer.</p>
        )}

        {boats.map((boat) => {
          const isPrimary = boat.id === primaryId;
          const loadoutSummary = buildLoadoutSummary(boat.loadout);
          const cond = boat.initialCondition;
          const condStr = `${cond.hull}/${cond.rig}/${cond.sails}/${cond.electronics}`;

          return (
            <div key={boat.id} className={isPrimary ? `${styles.card} ${styles.cardPrimary}` : styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.cardName}>{boat.name}</span>
                {isPrimary ? (
                  <span className={styles.primaryBadge}>Primary</span>
                ) : (
                  <label className={styles.primaryRadio}>
                    <input
                      type="radio"
                      name="primaryBoat"
                      checked={false}
                      onChange={() => onSetPrimary(boat.id)}
                    />
                    <span className={styles.primaryRadioLabel}>Principal</span>
                  </label>
                )}
              </div>

              <p className={styles.cardClass}>{CLASS_LABELS[boat.boatClass] ?? boat.boatClass}</p>

              <p className={styles.cardLoadout}>{loadoutSummary}</p>

              <p className={styles.cardConditions}>
                <span className={styles.footerLabel}>Cond · </span>
                {condStr}
              </p>

              <div className={styles.cardActions}>
                <button className={styles.btnEdit} onClick={() => onEditBoat(boat.id)}>
                  Éditer
                </button>
                <button className={styles.btnDelete} onClick={() => onDeleteBoat(boat.id)}>
                  Supprimer
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.addWrap}>
        <button
          className={styles.btnAdd}
          onClick={onAddBoat}
          disabled={boats.length >= 4}
        >
          + Ajouter un bateau
        </button>
      </div>

      <div className={styles.footer}>
        <p className={styles.footerLine}>
          <span className={styles.footerLabel}>Départ · </span>
          47.00°N · 3.00°W (Bay of Biscay)
        </p>
        <p className={styles.footerLine}>
          <span className={styles.footerLabel}>GFS run · </span>
          auto
        </p>
      </div>
    </div>
  );
}
