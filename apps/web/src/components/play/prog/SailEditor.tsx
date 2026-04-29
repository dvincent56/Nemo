'use client';
import { useState, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import type { SailId } from '@nemo/shared-types';
import type { SailOrder, WpOrder, ProgMode } from '@/lib/prog/types';
import { SAIL_DEFS, SAIL_ICONS } from '@/lib/sails/icons';
import TimeStepper from '../TimeStepper';
import styles from './Editor.module.css';
import sailStyles from './SailEditor.module.css';

export interface SailEditorProps {
  initialOrder: SailOrder | null;
  draftMode: ProgMode;
  /** WPs available for AT_WAYPOINT triggers. Already filtered to exclude
   * those that have a different sail order attached (the editor lets the
   * user keep the WP referenced by the order being edited). */
  availableWps: WpOrder[];
  /** Default trigger time for new orders */
  defaultTime: number;
  /** Floor for the TimeStepper minValue */
  minValueSec: number;
  nowSec: number;
  onCancel: () => void;
  onSave: (order: SailOrder) => void;
}

type TriggerKind = 'AT_TIME' | 'AT_WAYPOINT';

function makeId(): string {
  return `sail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SailEditor({
  initialOrder, draftMode, availableWps, defaultTime, minValueSec, nowSec, onCancel, onSave,
}: SailEditorProps): ReactElement {
  const isNew = initialOrder === null;
  const initialAuto = initialOrder?.action.auto ?? true;
  const initialSail: SailId = initialOrder && initialOrder.action.auto === false
    ? initialOrder.action.sail
    : 'JIB';
  const initialTriggerKind: TriggerKind = initialOrder?.trigger.type === 'AT_WAYPOINT' ? 'AT_WAYPOINT' : 'AT_TIME';
  const initialTime = initialOrder?.trigger.type === 'AT_TIME' ? initialOrder.trigger.time : defaultTime;
  const initialWpId = initialOrder?.trigger.type === 'AT_WAYPOINT'
    ? initialOrder.trigger.waypointOrderId
    : (availableWps[0]?.id ?? '');

  const [auto, setAuto] = useState<boolean>(initialAuto);
  const [sailId, setSailId] = useState<SailId>(initialSail);
  const [triggerKind, setTriggerKind] = useState<TriggerKind>(initialTriggerKind);
  const [time, setTime] = useState<number>(initialTime);
  const [wpId, setWpId] = useState<string>(initialWpId);

  // Force AT_TIME in cap mode (segmented picker not shown)
  const effectiveTriggerKind: TriggerKind = draftMode === 'cap' ? 'AT_TIME' : triggerKind;

  const canSave = effectiveTriggerKind === 'AT_TIME' || (effectiveTriggerKind === 'AT_WAYPOINT' && wpId !== '');

  const handleSave = (): void => {
    if (!canSave) return;
    const trigger: SailOrder['trigger'] = effectiveTriggerKind === 'AT_TIME'
      ? { type: 'AT_TIME', time }
      : { type: 'AT_WAYPOINT', waypointOrderId: wpId };
    const action: SailOrder['action'] = auto ? { auto: true } : { auto: false, sail: sailId };
    const order: SailOrder = {
      id: initialOrder?.id ?? makeId(),
      trigger,
      action,
    };
    onSave(order);
  };

  const title = isNew ? 'NOUVEL ORDRE VOILE' : 'MODIFIER VOILE';

  return (
    <div className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backBtn} onClick={onCancel}>
          <ArrowLeft size={11} strokeWidth={2} /> Annuler
        </button>
        <h3 className={styles.title}>{title}</h3>
        <span style={{ width: 70 }} />
      </header>

      <div className={styles.body}>
        {/* Mode segmented (Auto / Manuel) */}
        <div>
          <p className={styles.fieldLabel}>MODE</p>
          <div className={sailStyles.seg}>
            <button
              type="button"
              className={`${sailStyles.segBtn} ${auto ? sailStyles.segBtnActive : ''}`}
              onClick={() => setAuto(true)}
              aria-pressed={auto}
            >
              AUTO
            </button>
            <button
              type="button"
              className={`${sailStyles.segBtn} ${!auto ? sailStyles.segBtnActive : ''}`}
              onClick={() => setAuto(false)}
              aria-pressed={!auto}
            >
              MANUEL
            </button>
          </div>
        </div>

        {/* Sail grid (only when Manuel) */}
        {!auto && (
          <div>
            <p className={styles.fieldLabel}>VOILE À HISSER</p>
            <div className={sailStyles.sailGrid4}>
              {SAIL_DEFS.slice(0, 4).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`${sailStyles.sailTile} ${sailId === s.id ? sailStyles.sailTileActive : ''}`}
                  onClick={() => setSailId(s.id)}
                  aria-pressed={sailId === s.id}
                >
                  <div className={sailStyles.sailIconWrap}>{SAIL_ICONS[s.id]}</div>
                  <span className={sailStyles.sailIdLabel}>{s.id}</span>
                </button>
              ))}
            </div>
            <div className={sailStyles.sailGrid3}>
              {SAIL_DEFS.slice(4).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`${sailStyles.sailTile} ${sailId === s.id ? sailStyles.sailTileActive : ''}`}
                  onClick={() => setSailId(s.id)}
                  aria-pressed={sailId === s.id}
                >
                  <div className={sailStyles.sailIconWrap}>{SAIL_ICONS[s.id]}</div>
                  <span className={sailStyles.sailIdLabel}>{s.id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Trigger picker — only in WP mode (cap mode forces AT_TIME) */}
        {draftMode === 'wp' && (
          <div>
            <p className={styles.fieldLabel}>DÉCLENCHEUR</p>
            <div className={sailStyles.seg}>
              <button
                type="button"
                className={`${sailStyles.segBtn} ${triggerKind === 'AT_TIME' ? sailStyles.segBtnActive : ''}`}
                onClick={() => setTriggerKind('AT_TIME')}
                aria-pressed={triggerKind === 'AT_TIME'}
              >
                À UNE HEURE
              </button>
              <button
                type="button"
                className={`${sailStyles.segBtn} ${triggerKind === 'AT_WAYPOINT' ? sailStyles.segBtnActive : ''}`}
                onClick={() => setTriggerKind('AT_WAYPOINT')}
                aria-pressed={triggerKind === 'AT_WAYPOINT'}
                disabled={availableWps.length === 0}
              >
                À UN WAYPOINT
              </button>
            </div>
          </div>
        )}

        {/* Time stepper */}
        {effectiveTriggerKind === 'AT_TIME' && (
          <TimeStepper
            value={time}
            onChange={(t) => setTime(t)}
            minValue={minValueSec}
            nowSec={nowSec}
          />
        )}

        {/* WP picker */}
        {effectiveTriggerKind === 'AT_WAYPOINT' && (
          <div>
            <p className={styles.fieldLabel}>WAYPOINT</p>
            {availableWps.length === 0 ? (
              <div className={sailStyles.empty}>
                AUCUN WAYPOINT DISPONIBLE — TOUS DÉJÀ RÉFÉRENCÉS
              </div>
            ) : (
              <div className={sailStyles.wpList}>
                {availableWps.map((wp, idx) => (
                  <button
                    key={wp.id}
                    type="button"
                    className={`${sailStyles.wpItem} ${wpId === wp.id ? sailStyles.wpItemActive : ''}`}
                    onClick={() => setWpId(wp.id)}
                    aria-pressed={wpId === wp.id}
                  >
                    WP {idx + 1} · {wp.lat.toFixed(2)}°, {wp.lon.toFixed(2)}°
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          onClick={handleSave}
          disabled={!canSave}
        >
          <Check size={14} strokeWidth={2.5} />&nbsp;OK
        </button>
      </footer>
    </div>
  );
}
