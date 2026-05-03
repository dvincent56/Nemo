import { useTranslations } from 'next-intl';
import { type UpgradeSlot, type InstalledUpgrade } from '../data';
import type { SlotAvailability } from '@/lib/marina-api';
import Tooltip from '@/components/ui/Tooltip';
import { useUpgradeLabel } from '@/lib/upgrade-i18n';
import styles from './SlotCard.module.css';

interface SlotCardProps {
  slot: UpgradeSlot;
  availability: SlotAvailability;
  installed: InstalledUpgrade | undefined;
  locked: boolean;
  onChangeSlot: (slot: UpgradeSlot) => void;
}

export function SlotCard({ slot, availability, installed, locked, onChangeSlot }: SlotCardProps): React.ReactElement | null {
  const tSlot = useTranslations('marina.slots');
  const tTier = useTranslations('marina.tiers');
  const tCard = useTranslations('marina.slotCard');
  const upgradeLabel = useUpgradeLabel();

  if (availability === 'absent') return null;

  const isMonotype = availability === 'monotype';
  const itemName = installed
    ? upgradeLabel({ id: installed.catalogId, name: installed.name })
    : tTier('SERIE');
  const itemTier = installed?.tier ?? 'SERIE';
  const itemProfile = installed?.profile ?? '';
  const cardCls = `${styles.card} ${isMonotype ? styles.cardMonotype : ''} ${locked ? styles.cardLocked : ''}`;

  return (
    <article className={cardCls}>
      <div className={styles.head}>
        <h4 className={styles.slotName}>{tSlot(slot)}</h4>
        <span className={`${styles.tier} ${styles[`tier${itemTier}`] ?? ''}`}>
          {tTier(itemTier)}
        </span>
      </div>
      <p className={styles.itemName}>{itemName}</p>
      {itemProfile && <p className={styles.profile}>{itemProfile}</p>}

      {isMonotype ? (
        <p className={styles.monotype}>{tCard('monotype')}</p>
      ) : locked ? (
        <Tooltip text={tCard('lockedTooltip')} position="bottom">
          <button type="button" className={styles.changeBtn} disabled>
            {tCard('change')}
          </button>
        </Tooltip>
      ) : (
        <button
          type="button"
          className={styles.changeBtn}
          onClick={() => onChangeSlot(slot)}
        >
          {tCard('change')}
        </button>
      )}
    </article>
  );
}
