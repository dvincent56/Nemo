import { SLOT_LABEL, TIER_LABEL, type UpgradeSlot, type InstalledUpgrade } from '../data';
import type { SlotAvailability } from '@/lib/marina-api';
import Tooltip from '@/components/ui/Tooltip';
import styles from './SlotCard.module.css';

interface SlotCardProps {
  slot: UpgradeSlot;
  availability: SlotAvailability;
  installed: InstalledUpgrade | undefined;
  locked: boolean;
  onChangeSlot: (slot: UpgradeSlot) => void;
}

export function SlotCard({ slot, availability, installed, locked, onChangeSlot }: SlotCardProps): React.ReactElement | null {
  if (availability === 'absent') return null;

  const isMonotype = availability === 'monotype';
  const itemName = installed?.name ?? 'Série';
  const itemTier = installed?.tier ?? 'SERIE';
  const itemProfile = installed?.profile ?? '';
  const cardCls = `${styles.card} ${isMonotype ? styles.cardMonotype : ''} ${locked ? styles.cardLocked : ''}`;

  return (
    <article className={cardCls}>
      <div className={styles.head}>
        <h4 className={styles.slotName}>{SLOT_LABEL[slot]}</h4>
        <span className={`${styles.tier} ${styles[`tier${itemTier}`] ?? ''}`}>
          {TIER_LABEL[itemTier]}
        </span>
      </div>
      <p className={styles.itemName}>{itemName}</p>
      {itemProfile && <p className={styles.profile}>{itemProfile}</p>}

      {isMonotype ? (
        <p className={styles.monotype}>Réglementation classe</p>
      ) : locked ? (
        <Tooltip text="Modification impossible pendant la course" position="top">
          <button type="button" className={styles.changeBtn} disabled>
            Changer →
          </button>
        </Tooltip>
      ) : (
        <button
          type="button"
          className={styles.changeBtn}
          onClick={() => onChangeSlot(slot)}
        >
          Changer →
        </button>
      )}
    </article>
  );
}
