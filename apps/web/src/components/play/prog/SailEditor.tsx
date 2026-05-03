'use client';
import { useEffect, useState, type ReactElement } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SailId } from '@nemo/shared-types';
import type { SailOrder, WpOrder, ProgMode } from '@/lib/prog/types';
import { useGameStore } from '@/lib/store';
import { useThrottledEffect } from '@/hooks/useThrottledEffect';
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
  /** Ceiling for the TimeStepper maxValue (now+J+5). Optional. */
  maxValueSec?: number;
  nowSec: number;
  /** When true, the boat is already in sail-auto by the time this order
   *  would fire — so emitting another auto-sail order is a no-op. The
   *  Auto segment is disabled to make this clear, and a new order
   *  defaults to Manuel rather than Auto. */
  priorIsAuto: boolean;
  /** Additional floor (unix sec) imposed by a previous AT_TIME sail order
   *  whose transition has not finished. The TimeStepper's effective minimum
   *  is `max(minValueSec, minTimeFromTransition)`. Below this floor a warning
   *  is shown and the order can't be saved. Optional — when omitted, no
   *  transition lockout applies. */
  minTimeFromTransition?: number;
  onCancel: () => void;
  onSave: (order: SailOrder) => void;
}

type TriggerKind = 'AT_TIME' | 'AT_WAYPOINT';

function makeId(): string {
  return `sail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function SailEditor({
  initialOrder, draftMode, availableWps, defaultTime, minValueSec, maxValueSec, nowSec, priorIsAuto, minTimeFromTransition, onCancel, onSave,
}: SailEditorProps): ReactElement {
  const t = useTranslations('play.progEditor');
  const isNew = initialOrder === null;
  // If the boat is already in auto at this order's trigger time, emitting
  // another auto-sail order is a no-op — default a new order to Manuel so
  // the user has a meaningful action to confirm.
  const initialAuto = initialOrder?.action.auto ?? !priorIsAuto;
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

  // Publish a live editor preview to the store. AT_TIME ghosts splice into
  // the draft segments AND drive the sliding marker; AT_WAYPOINT ghosts
  // splice into segments too (so the polyline reflects the upcoming sail
  // change at WP capture) but skip the marker (the WP location is already
  // a separate marker). When wpId is empty the AT_WAYPOINT ghost is
  // invalid — skip publishing so the worker isn't fed a half-built order.
  //
  // Throttled at 100 ms (mirrors CapEditor): fire on first change then at
  // most ~10 Hz. Solves the flicker the original debounce caused during a
  // fast TimeStepper hold.
  const setEditorPreview = useGameStore((s) => s.setEditorPreview);
  useThrottledEffect(() => {
    let trigger: SailOrder['trigger'] | null;
    if (effectiveTriggerKind === 'AT_TIME') {
      trigger = { type: 'AT_TIME', time };
    } else if (wpId !== '') {
      trigger = { type: 'AT_WAYPOINT', waypointOrderId: wpId };
    } else {
      trigger = null;
    }
    if (trigger === null) {
      setEditorPreview(null);
      return;
    }
    const action: SailOrder['action'] = auto
      ? { auto: true }
      : { auto: false, sail: sailId };
    const ghost: SailOrder = {
      id: initialOrder?.id ?? 'editor-ghost-sail',
      trigger,
      action,
    };
    setEditorPreview({
      kind: 'sail',
      ghostOrder: ghost,
      replacesId: initialOrder?.id ?? null,
    });
  }, [effectiveTriggerKind, time, wpId, auto, sailId, initialOrder?.id, setEditorPreview], 100);

  // Unmount-only cleanup: drop the ghost on editor close.
  useEffect(() => () => setEditorPreview(null), [setEditorPreview]);

  // No-op guard: an auto-sail order when the boat is already in auto-sail at
  // the trigger time changes nothing. Refuse to save instead of letting the
  // user pile up phantom orders. Validated on save in addition to the segment
  // disabled state so the safeguard works even when the segment is bypassed
  // (e.g. editing an existing auto order whose prior state is still auto).
  const isAutoNoOp = auto && priorIsAuto;

  // Transition lockout: a previous AT_TIME sail order's transition has not
  // finished by `time`. AT_WAYPOINT triggers are not subject to this floor —
  // the engine resolves their effective time dynamically based on routing.
  const transitionFloor = minTimeFromTransition ?? minValueSec;
  const isBlockedByTransition =
    effectiveTriggerKind === 'AT_TIME' && time < transitionFloor;
  const effectiveMinValueSec = Math.max(minValueSec, transitionFloor);

  const triggerOk = effectiveTriggerKind === 'AT_TIME' || (effectiveTriggerKind === 'AT_WAYPOINT' && wpId !== '');
  const canSave = triggerOk && !isAutoNoOp && !isBlockedByTransition;

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

  const title = isNew ? t('sail.titleNew') : t('sail.titleEdit');

  return (
    <div className={styles.editor}>
      <header className={styles.editorHeader}>
        <button type="button" className={styles.backBtn} onClick={onCancel}>
          <ArrowLeft size={11} strokeWidth={2} /> {t('back')}
        </button>
        <h3 className={styles.title}>{title}</h3>
        <span style={{ width: 70 }} />
      </header>

      <div className={styles.body}>
        {/* Mode segmented (Auto / Manuel) */}
        <div>
          <p className={styles.fieldLabel}>{t('sail.mode')}</p>
          <div className={sailStyles.seg}>
            <button
              type="button"
              className={`${sailStyles.segBtn} ${auto ? sailStyles.segBtnActive : ''}`}
              onClick={() => setAuto(true)}
              disabled={priorIsAuto}
              title={priorIsAuto ? t('sail.alreadyAuto') : undefined}
              aria-pressed={auto}
            >
              {t('sail.auto')}
            </button>
            <button
              type="button"
              className={`${sailStyles.segBtn} ${!auto ? sailStyles.segBtnActive : ''}`}
              onClick={() => setAuto(false)}
              aria-pressed={!auto}
            >
              {t('sail.manual')}
            </button>
          </div>
          {isAutoNoOp && (
            <p className={sailStyles.warnText}>
              {t('sail.warnAutoNoOp')}
            </p>
          )}
        </div>

        {/* Sail grid (only when Manuel) */}
        {!auto && (
          <div>
            <p className={styles.fieldLabel}>{t('sail.sailToHoist')}</p>
            <div className={sailStyles.sailGrid}>
              {SAIL_DEFS.map((s) => (
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
            <p className={styles.fieldLabel}>{t('sail.trigger')}</p>
            <div className={sailStyles.seg}>
              <button
                type="button"
                className={`${sailStyles.segBtn} ${triggerKind === 'AT_TIME' ? sailStyles.segBtnActive : ''}`}
                onClick={() => setTriggerKind('AT_TIME')}
                aria-pressed={triggerKind === 'AT_TIME'}
              >
                {t('sail.atTime')}
              </button>
              <button
                type="button"
                className={`${sailStyles.segBtn} ${triggerKind === 'AT_WAYPOINT' ? sailStyles.segBtnActive : ''}`}
                onClick={() => setTriggerKind('AT_WAYPOINT')}
                aria-pressed={triggerKind === 'AT_WAYPOINT'}
                disabled={availableWps.length === 0}
              >
                {t('sail.atWaypoint')}
              </button>
            </div>
          </div>
        )}

        {/* Time stepper */}
        {effectiveTriggerKind === 'AT_TIME' && (
          <>
            <TimeStepper
              value={time}
              onChange={(newTime) => setTime(newTime)}
              minValue={effectiveMinValueSec}
              {...(maxValueSec !== undefined ? { maxValue: maxValueSec } : {})}
              nowSec={nowSec}
            />
            {isBlockedByTransition && (
              <p className={sailStyles.warnText}>
                {t('sail.warnTransition')}
              </p>
            )}
          </>
        )}

        {/* WP picker */}
        {effectiveTriggerKind === 'AT_WAYPOINT' && (
          <div>
            <p className={styles.fieldLabel}>{t('sail.wpLabel')}</p>
            {availableWps.length === 0 ? (
              <div className={sailStyles.empty}>
                {t('sail.noWpAvail')}
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
                    {t('sail.wpItem', { n: idx + 1 })} · {wp.lat.toFixed(2)}°, {wp.lon.toFixed(2)}°
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.footerBtn} onClick={onCancel}>
          {t('back')}
        </button>
        <button
          type="button"
          className={`${styles.footerBtn} ${styles.footerBtnPrimary}`}
          onClick={handleSave}
          disabled={!canSave}
        >
          <Check size={14} strokeWidth={2.5} />&nbsp;{t('ok')}
        </button>
      </footer>
    </div>
  );
}
