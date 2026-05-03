'use client';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { Anchor, MapPin, Wind, Pencil, Trash2, Plus, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProgDraft, ProgMode } from '@/lib/prog/types';
import { isObsoleteAtTime } from '@/lib/prog/anchors';
import styles from './ProgQueueView.module.css';

export interface ProgQueueViewProps {
  draft: ProgDraft;
  nowSec: number;
  onSwitchMode: (mode: ProgMode) => void;
  onAddCap: () => void;
  onAddWp: () => void;
  onAddFinalCap: () => void;
  onAddSail: () => void;
  onEditCap: (id: string) => void;
  onEditWp: (id: string) => void;
  onEditFinalCap: () => void;
  onEditSail: (id: string) => void;
  onAskDelete: (kind: 'cap' | 'wp' | 'finalCap' | 'sail', id: string) => void;
  onAskClearAll: () => void;
}

function formatAbsolute(sec: number): string {
  const totalMin = Math.floor(sec / 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatRelative(sec: number, nowSec: number): string {
  const dSec = sec - nowSec;
  const dMin = Math.floor(dSec / 60);
  if (dMin < 0) return `${dMin}min`;
  if (dMin < 60) return `+${dMin}min`;
  const h = Math.floor(dMin / 60);
  const m = dMin % 60;
  return m === 0 ? `+${h}h` : `+${h}h ${m}min`;
}

export default function ProgQueueView(props: ProgQueueViewProps): ReactElement {
  const t = useTranslations('play.progQueue');
  const { draft, nowSec } = props;

  const sortedCaps = useMemo(
    () => [...draft.capOrders].sort((a, b) => a.trigger.time - b.trigger.time),
    [draft.capOrders],
  );

  const sortedSails = useMemo(() => {
    return [...draft.sailOrders].sort((a, b) => {
      if (a.trigger.type === 'AT_TIME' && b.trigger.type === 'AT_TIME') {
        return a.trigger.time - b.trigger.time;
      }
      if (a.trigger.type === 'AT_TIME') return -1;
      if (b.trigger.type === 'AT_TIME') return 1;
      const ai = draft.wpOrders.findIndex((w) => w.id === (a.trigger as { waypointOrderId: string }).waypointOrderId);
      const bi = draft.wpOrders.findIndex((w) => w.id === (b.trigger as { waypointOrderId: string }).waypointOrderId);
      return ai - bi;
    });
  }, [draft.sailOrders, draft.wpOrders]);

  const totalOrders = draft.capOrders.length + draft.wpOrders.length + (draft.finalCap ? 1 : 0) + draft.sailOrders.length;

  return (
    <div className={styles.body}>
      {/* Mode tabs */}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${draft.mode === 'cap' ? styles.tabActive : ''}`}
          onClick={() => props.onSwitchMode('cap')}
          aria-pressed={draft.mode === 'cap'}
        >
          <Anchor size={14} strokeWidth={2} /> {t('tabs.cap')}
        </button>
        <button
          type="button"
          className={`${styles.tab} ${draft.mode === 'wp' ? styles.tabActive : ''}`}
          onClick={() => props.onSwitchMode('wp')}
          aria-pressed={draft.mode === 'wp'}
        >
          <MapPin size={14} strokeWidth={2} /> {t('tabs.wp')}
        </button>
      </div>

      {/* Cap mode list */}
      {draft.mode === 'cap' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <span>{t('cap.title')}</span>
            <small>{t('cap.count', { n: sortedCaps.length })}</small>
          </div>
          {sortedCaps.length === 0 ? (
            <div className={styles.empty}>{t('cap.empty')}</div>
          ) : (
            <div className={styles.orderList}>
              {sortedCaps.map((o, idx) => {
                const obsolete = isObsoleteAtTime(o.trigger, nowSec);
                return (
                  <div
                    key={o.id}
                    className={`${styles.orderCard} ${obsolete ? styles.obsolete : ''}`}
                    onClick={() => props.onEditCap(o.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className={styles.orderIdx}>{String(idx + 1).padStart(2, '0')}</span>
                    <span className={styles.orderIco}><Anchor size={14} strokeWidth={2} /></span>
                    <div className={styles.orderMeta}>
                      <div className={styles.orderWhen}>
                        {formatAbsolute(o.trigger.time)} · {formatRelative(o.trigger.time, nowSec)}
                        {obsolete && t('cap.obsoleteSuffix')}
                      </div>
                      <div className={styles.orderWhat}>
                        {t('cap.actionLabel')} <b>{String(o.heading).padStart(3, '0')}°</b>{o.twaLock ? t('cap.twaSuffix') : ''}
                      </div>
                    </div>
                    <div className={styles.orderActions}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); props.onEditCap(o.id); }}
                        aria-label={t('actions.edit')}
                      >
                        <Pencil size={11} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className={styles.delBtn}
                        onClick={(e) => { e.stopPropagation(); props.onAskDelete('cap', o.id); }}
                        aria-label={t('actions.delete')}
                      >
                        <Trash2 size={11} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <button type="button" className={styles.addBtn} onClick={props.onAddCap}>
            <Plus size={14} strokeWidth={2} /> {t('cap.addBtn')}
          </button>
        </div>
      )}

      {/* WP mode list */}
      {draft.mode === 'wp' && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <span>{t('wp.title')}</span>
            <small>{t('wp.count', { n: draft.wpOrders.length })}</small>
          </div>
          {draft.wpOrders.length === 0 ? (
            <div className={styles.empty}>{t('wp.empty')}</div>
          ) : (
            <div className={styles.orderList}>
              {draft.wpOrders.map((o, idx) => {
                const trig = o.trigger;
                const triggerLabel = trig.type === 'IMMEDIATE'
                  ? t('wp.atDeparture')
                  : t('wp.afterWp', { n: draft.wpOrders.findIndex((w) => w.id === trig.waypointOrderId) + 1 });
                return (
                  <div
                    key={o.id}
                    className={styles.orderCard}
                    onClick={() => props.onEditWp(o.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className={styles.orderIdx}>{String(idx + 1).padStart(2, '0')}</span>
                    <span className={styles.orderIco}><MapPin size={14} strokeWidth={2} /></span>
                    <div className={styles.orderMeta}>
                      <div className={styles.orderWhen}>{triggerLabel}</div>
                      <div className={styles.orderWhat}>
                        <b>{t('wp.wpLabel', { n: idx + 1 })}</b> · {o.lat.toFixed(2)}°, {o.lon.toFixed(2)}°
                      </div>
                    </div>
                    <div className={styles.orderActions}>
                      <button type="button" onClick={(e) => { e.stopPropagation(); props.onEditWp(o.id); }} aria-label={t('actions.edit')}>
                        <Pencil size={11} strokeWidth={2} />
                      </button>
                      <button type="button" className={styles.delBtn} onClick={(e) => { e.stopPropagation(); props.onAskDelete('wp', o.id); }} aria-label={t('actions.delete')}>
                        <Trash2 size={11} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {draft.finalCap && (
                <div
                  className={`${styles.orderCard} ${styles.finalCap}`}
                  onClick={() => props.onEditFinalCap()}
                  role="button"
                  tabIndex={0}
                >
                  <span className={styles.orderIdx}>★</span>
                  <span className={styles.orderIco}><Anchor size={14} strokeWidth={2} /></span>
                  <div className={styles.orderMeta}>
                    <div className={styles.orderWhen}>
                      {t('wp.afterWpFinal', { n: draft.wpOrders.findIndex((w) => w.id === draft.finalCap!.trigger.waypointOrderId) + 1 })}
                    </div>
                    <div className={styles.orderWhat}>
                      {t('wp.finalActionLabel')} <b>{String(draft.finalCap.heading).padStart(3, '0')}°</b>{draft.finalCap.twaLock ? t('cap.twaSuffix') : ''}
                    </div>
                  </div>
                  <div className={styles.orderActions}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); props.onEditFinalCap(); }} aria-label={t('actions.edit')}>
                      <Pencil size={11} strokeWidth={2} />
                    </button>
                    <button type="button" className={styles.delBtn} onClick={(e) => { e.stopPropagation(); props.onAskDelete('finalCap', draft.finalCap!.id); }} aria-label={t('actions.delete')}>
                      <Trash2 size={11} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className={styles.addRow}>
            <button type="button" className={styles.addBtn} onClick={props.onAddWp}>
              <Plus size={14} strokeWidth={2} /> {t('wp.addBtn')}
            </button>
            {draft.wpOrders.length >= 1 && !draft.finalCap && (
              <button type="button" className={styles.addBtn} onClick={props.onAddFinalCap}>
                <Plus size={14} strokeWidth={2} /> {t('wp.addFinalCap')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sail orders section (always visible) */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span>{t('sail.title')}</span>
          <small>{t('sail.count', { n: sortedSails.length })}</small>
        </div>
        {sortedSails.length === 0 ? (
          <div className={styles.empty}>{t('sail.empty')}</div>
        ) : (
          <div className={styles.orderList}>
            {sortedSails.map((o) => {
              const trig = o.trigger;
              const obsolete = trig.type === 'AT_TIME' && isObsoleteAtTime(trig, nowSec);
              const whenLabel = trig.type === 'AT_TIME'
                ? `${formatAbsolute(trig.time)} · ${formatRelative(trig.time, nowSec)}${obsolete ? t('cap.obsoleteSuffix') : ''}`
                : t('sail.atWp', { n: draft.wpOrders.findIndex((w) => w.id === trig.waypointOrderId) + 1 });
              const actionLabel = o.action.auto
                ? <>{t('sail.actionLabel')} <b>{t('sail.actionAuto')}</b></>
                : <>{t('sail.actionLabel')} <b>{o.action.sail}</b></>;
              return (
                <div
                  key={o.id}
                  className={`${styles.orderCard} ${obsolete ? styles.obsolete : ''}`}
                  onClick={() => props.onEditSail(o.id)}
                  role="button"
                  tabIndex={0}
                >
                  <span className={styles.orderIdx}>—</span>
                  <span className={styles.orderIco}><Wind size={14} strokeWidth={2} /></span>
                  <div className={styles.orderMeta}>
                    <div className={styles.orderWhen}>{whenLabel}</div>
                    <div className={styles.orderWhat}>{actionLabel}</div>
                  </div>
                  <div className={styles.orderActions}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); props.onEditSail(o.id); }} aria-label={t('actions.edit')}>
                      <Pencil size={11} strokeWidth={2} />
                    </button>
                    <button type="button" className={styles.delBtn} onClick={(e) => { e.stopPropagation(); props.onAskDelete('sail', o.id); }} aria-label={t('actions.delete')}>
                      <Trash2 size={11} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className={styles.addBtn} onClick={props.onAddSail}>
          <Plus size={14} strokeWidth={2} /> {t('sail.addBtn')}
        </button>
      </div>

      {/* Clear all */}
      {totalOrders > 0 && (
        <button type="button" className={styles.clearAll} onClick={props.onAskClearAll}>
          <Trash2 size={11} strokeWidth={2} /> {t('clearAll')}
        </button>
      )}

      {/* Multi-tab note */}
      <div className={styles.multiTabNote}>
        <Info size={11} strokeWidth={2} />
        <span>{t('multiTabNote')}</span>
      </div>
    </div>
  );
}
