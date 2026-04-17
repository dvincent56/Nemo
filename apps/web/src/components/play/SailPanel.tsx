'use client';

import { useState } from 'react';
import type { SailId } from '@nemo/shared-types';
import { sendOrder, useGameStore } from '@/lib/store';
import styles from './SailPanel.module.css';

const SAILS: { id: SailId; name: string; desc: string; twa: string; range: [number, number] }[] = [
  { id: 'LW', name: 'Light Wind', desc: 'Genoa petit temps', twa: 'TWA 0–60°', range: [0, 60] },
  { id: 'JIB', name: 'Foc', desc: 'Foc standard', twa: 'TWA 30–100°', range: [30, 100] },
  { id: 'GEN', name: 'Genoa', desc: 'Genoa polyvalent', twa: 'TWA 50–140°', range: [50, 140] },
  { id: 'C0', name: 'Code 0', desc: 'Reaching léger', twa: 'TWA 60–150°', range: [60, 150] },
  { id: 'HG', name: 'Heavy Genoa', desc: 'Allure soutenue', twa: 'TWA 100–170°', range: [100, 170] },
  { id: 'SPI', name: 'Spinnaker', desc: 'Spi asymétrique', twa: 'TWA 120–180°', range: [120, 180] },
];

export default function SailPanel(): React.ReactElement {
  const sailState = useGameStore((s) => s.sail);
  const twa = useGameStore((s) => s.hud.twa);
  const { currentSail, sailAuto, transitionRemainingSec, sailPending } = sailState;
  const [candidateSail, setCandidateSail] = useState<SailId | null>(null);

  const absTwa = Math.abs(twa);

  // Check if current sail is wrong for current TWA (manual mode feedback)
  const isWrongSail = !sailAuto && SAILS.some((s) => {
    if (s.id !== currentSail) return false;
    return absTwa < s.range[0] || absTwa > s.range[1];
  });

  const onSailClick = (id: SailId) => {
    if (id === currentSail || transitionRemainingSec > 0) return;
    setCandidateSail(id);
  };

  const confirmSail = () => {
    if (!candidateSail) return;
    sendOrder({ type: 'SAIL', value: { sail: candidateSail } });
    useGameStore.getState().setSail({ sailPending: candidateSail });
    setCandidateSail(null);
  };

  const toggleAuto = () => {
    sendOrder({ type: 'MODE', value: { auto: !sailAuto } });
    useGameStore.getState().toggleSailAuto();
  };

  return (
    <div>
      {/* Mode toggle */}
      <div className={styles.modeToggle}>
        <button type="button" className={`${styles.modeBtn} ${sailAuto ? styles.modeBtnActive : ''}`} onClick={() => { if (!sailAuto) toggleAuto(); }}>
          Auto
        </button>
        <button type="button" className={`${styles.modeBtn} ${!sailAuto ? styles.modeBtnActive : ''}`} onClick={() => { if (sailAuto) toggleAuto(); }}>
          Manuel
        </button>
      </div>

      {/* Wrong sail alert */}
      {isWrongSail && (
        <div className={styles.wrongSailAlert}>
          ⚠ Voile non optimale pour le TWA actuel ({Math.round(absTwa)}°)
        </div>
      )}

      {/* Current sail */}
      <div className={styles.currentSail}>
        <div>
          <p className={styles.currentLabel}>En route</p>
          <p className={styles.currentName}>{currentSail}</p>
        </div>
        <div>
          <p className={styles.currentTwa}>TWA {Math.round(absTwa)}°</p>
        </div>
      </div>

      {/* Sail list */}
      <div className={styles.sailList}>
        {SAILS.map((s) => {
          const isActive = s.id === currentSail;
          const inRange = absTwa >= s.range[0] && absTwa <= s.range[1];
          const disabled = !inRange && !isActive;
          return (
            <button
              key={s.id}
              type="button"
              className={`${styles.sailRow} ${isActive ? styles.sailRowActive : ''} ${disabled ? styles.sailRowDisabled : ''}`}
              onClick={() => !disabled && onSailClick(s.id)}
              disabled={disabled}
            >
              <span className={styles.sailRowName}>{s.id}</span>
              <div>
                <div className={styles.sailRowDesc}>{s.desc}</div>
                <div className={styles.sailRowSub}>{isActive ? (sailAuto ? 'Sélectionnée (auto)' : 'Active') : disabled ? 'Hors plage TWA' : 'Disponible'}</div>
              </div>
              <span className={styles.sailRowRange}>{s.twa}</span>
            </button>
          );
        })}
      </div>

      {/* Transition timer */}
      {transitionRemainingSec > 0 && (
        <div className={styles.transition}>
          Transition en cours · {Math.ceil(transitionRemainingSec)}s
          {sailPending && ` → ${sailPending}`}
        </div>
      )}

      {/* Confirm strip */}
      {candidateSail && (
        <div className={styles.confirmStrip}>
          <span className={styles.confirmText}>Changer pour <strong>{candidateSail}</strong> ?</span>
          <button type="button" className={styles.confirmCancel} onClick={() => setCandidateSail(null)}>Annuler</button>
          <button type="button" className={styles.confirmOk} onClick={confirmSail}>Confirmer</button>
        </div>
      )}
    </div>
  );
}
