'use client';

import { useState } from 'react';
import type { SailId } from '@nemo/shared-types';
import { sendOrder, useGameStore } from '@/lib/store';
import styles from './SailPanel.module.css';

const SAILS: { id: SailId; twa: string }[] = [
  { id: 'LW', twa: '0–60°' },
  { id: 'JIB', twa: '30–100°' },
  { id: 'GEN', twa: '50–140°' },
  { id: 'C0', twa: '60–150°' },
  { id: 'HG', twa: '100–170°' },
  { id: 'SPI', twa: '120–180°' },
];

export default function SailPanel(): React.ReactElement {
  const sailState = useGameStore((s) => s.sail);
  const { currentSail: sail, sailAuto, transitionRemainingSec } = sailState;

  const [candidateSail, setCandidateSail] = useState<SailId | null>(null);
  const [autoPending, setAutoPending] = useState(false);

  const onTileClick = (id: SailId): void => {
    if (id === sail) { setCandidateSail(null); return; }
    setCandidateSail(id);
  };

  const cancel = (): void => setCandidateSail(null);

  const confirmSail = (): void => {
    if (!candidateSail) return;
    sendOrder({ type: 'SAIL', value: { sail: candidateSail } });
    useGameStore.getState().setSail({ sailPending: candidateSail });
    setCandidateSail(null);
  };

  const confirmAuto = (): void => {
    sendOrder({ type: 'MODE', value: { auto: !sailAuto } });
    useGameStore.getState().toggleSailAuto();
    setAutoPending(false);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <h3 className={styles.title}>Voiles</h3>
        <div className={styles.toggleWrap}>
          <button
            type="button"
            className={`${styles.toggleBtn} ${!sailAuto ? styles.toggleActive : ''} ${autoPending && !sailAuto ? styles.togglePending : ''}`}
            onClick={() => { if (!sailAuto) return; setAutoPending(true); }}
          >MAN</button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${sailAuto ? styles.toggleActive : ''} ${autoPending && sailAuto ? styles.togglePending : ''}`}
            onClick={() => { if (sailAuto) return; setAutoPending(true); }}
          >AUTO</button>
        </div>
      </div>

      {autoPending && (
        <div className={styles.strip}>
          <span className={styles.stripLabel}>
            Passer en <strong>{sailAuto ? 'MANUEL' : 'AUTO'}</strong> ?
          </span>
          <button className={styles.btnCancel} onClick={() => setAutoPending(false)}>ANNULER</button>
          <button className={styles.btnConfirm} onClick={confirmAuto}>CONFIRMER</button>
        </div>
      )}

      <div className={styles.grid}>
        {SAILS.map((s) => {
          const isActive = s.id === sail;
          const isPending = s.id === candidateSail;
          const cls = [
            styles.tile,
            isActive ? styles.tileActive : '',
            isPending ? styles.tilePending : '',
          ].filter(Boolean).join(' ');
          return (
            <button key={s.id} type="button" className={cls} onClick={() => onTileClick(s.id)}>
              <span className={styles.tileCode}>{s.id}</span>
              <span className={styles.tileTwa}>{s.twa}</span>
            </button>
          );
        })}
      </div>

      {transitionRemainingSec > 0 && (
        <div className={styles.transition}>
          TRANSITION · {Math.ceil(transitionRemainingSec)}s restantes
        </div>
      )}

      {candidateSail && (
        <div className={styles.strip}>
          <span className={styles.stripLabel}>
            Passer en <strong>{candidateSail}</strong> ?
          </span>
          <button className={styles.btnCancel} onClick={cancel}>ANNULER</button>
          <button className={styles.btnConfirm} onClick={confirmSail}>CONFIRMER</button>
        </div>
      )}
    </div>
  );
}
