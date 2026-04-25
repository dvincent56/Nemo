'use client';

import { useEffect, useMemo, useState } from 'react';
import type { OrderTrigger } from '@nemo/shared-types';
import { sendOrder, useGameStore } from '@/lib/store';
import { isObsolete, validateLeadTime, MIN_LEAD_TIME_MS } from '@/lib/orders/obsolete';
import { haversinePosNM } from '@/lib/geo';
import Toast, { type ToastType } from '@/components/ui/Toast';
import styles from './ProgPanel.module.css';

type TabId = 'cap' | 'waypoints' | 'sails';
type TriggerKind = 'at_time' | 'at_waypoint' | 'after_duration';

/** Local datetime string (YYYY-MM-DDTHH:mm) for <input type="datetime-local">
 * default set at now + 15 min so the user lands on a valid value. */
function defaultAtTime(): string {
  const t = new Date(Date.now() + 15 * 60 * 1000);
  t.setSeconds(0, 0);
  const off = t.getTimezoneOffset();
  const local = new Date(t.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

const TRIGGER_DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short', day: '2-digit', month: 'short',
  hour: '2-digit', minute: '2-digit',
});

function formatTrigger(trigger: OrderTrigger, labelById?: Map<string, string>): string {
  switch (trigger.type) {
    case 'AT_TIME':
      return TRIGGER_DATE_FMT.format(new Date(trigger.time * 1000));
    case 'AFTER_DURATION':
      return `Dans ${Math.round(trigger.duration / 60)} min`;
    case 'AT_WAYPOINT': {
      // Resolve the predecessor's user-facing label (e.g. "WP 1") instead of
      // surfacing the internal uid like "wpt-1777148215048-27".
      const ref = labelById?.get(trigger.waypointOrderId) ?? trigger.waypointOrderId;
      return `Au ${ref}`;
    }
    case 'IMMEDIATE':
    case 'SEQUENTIAL':
      return trigger.type;
  }
}

/** AT_TIME lead time < 5 min → soon-obsolete (user should remove or fix). */
function isStale(trigger: OrderTrigger, nowMs: number): boolean {
  if (trigger.type === 'AT_TIME') {
    return trigger.time * 1000 - nowMs < MIN_LEAD_TIME_MS;
  }
  return false;
}

export default function ProgPanel(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('cap');
  const [capValue, setCapValue] = useState('225');
  const [trigger, setTrigger] = useState<TriggerKind>('at_time');
  const [atTimeValue, setAtTimeValue] = useState(defaultAtTime);
  const [afterDurationMin, setAfterDurationMin] = useState(30);
  const [atWaypointId, setAtWaypointId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const orderQueue = useGameStore((s) => s.prog.orderQueue);
  const addOrder = useGameStore((s) => s.addOrder);
  const removeOrder = useGameStore((s) => s.removeOrder);

  // 1 Hz tick so AT_TIME orders get a live "⚠ bientôt obsolète" badge when
  // their lead time drops below 5 min while the panel is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-removal of executed orders. Heuristic — engine state is canonical, but
  // for ProgPanel display purposes we sweep the queue every 5 s and drop:
  //   - AT_TIME triggers whose target is in the past
  //   - WPT orders whose waypoint has been "captured" (boat within
  //     captureRadiusNm) — including predecessors in a chained AT_WAYPOINT chain
  //     when a successor has been captured
  //   - Committed IMMEDIATE orders that have aged > 5 s
  //
  // AFTER_DURATION and SEQUENTIAL are intentionally left alone (no client-side
  // reliable signal — clientTs is not retained on OrderEntry).
  useEffect(() => {
    const tick = () => {
      const state = useGameStore.getState();
      const nowMs = Date.now();
      const lat = state.hud.lat;
      const lon = state.hud.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') return;

      const queue = state.prog.orderQueue;
      const wptOrders = queue.filter((o) => o.type === 'WPT');

      // Pass 1: WPTs the boat is currently within their capture radius.
      const capturedIds = new Set<string>();
      for (const o of wptOrders) {
        const wptLat = o.value['lat'];
        const wptLon = o.value['lon'];
        const radiusRaw = o.value['captureRadiusNm'];
        const radius = typeof radiusRaw === 'number' && radiusRaw > 0 ? radiusRaw : 0.5;
        if (typeof wptLat === 'number' && typeof wptLon === 'number') {
          const dNm = haversinePosNM({ lat, lon }, { lat: wptLat, lon: wptLon });
          if (dNm < radius) capturedIds.add(o.id);
        }
      }

      // Pass 2: walk the AT_WAYPOINT chain backwards. If WPT C is captured,
      // every predecessor (B, A, …) referenced through trigger.waypointOrderId
      // is also done.
      for (const o of wptOrders) {
        if (!capturedIds.has(o.id)) continue;
        if (o.trigger.type !== 'AT_WAYPOINT') continue;
        let prevId: string | undefined = o.trigger.waypointOrderId;
        const guard = new Set<string>(); // cycle guard
        while (prevId && !guard.has(prevId)) {
          guard.add(prevId);
          capturedIds.add(prevId);
          const prev = wptOrders.find((w) => w.id === prevId);
          if (!prev || prev.trigger.type !== 'AT_WAYPOINT') break;
          prevId = prev.trigger.waypointOrderId;
        }
      }

      const toRemove: string[] = [];
      for (const o of queue) {
        if (o.trigger.type === 'AT_TIME' && o.trigger.time * 1000 < nowMs) {
          toRemove.push(o.id);
        } else if (o.type === 'WPT' && capturedIds.has(o.id)) {
          toRemove.push(o.id);
        } else if (
          o.trigger.type === 'IMMEDIATE' &&
          o.committed === true
        ) {
          // Estimate age via the trailing timestamp in the order id (uid format
          // historically `<prefix>-<Date.now()>-<counter>` or `order-<Date.now()>`).
          const m = /-(\d{10,})(?:-\d+)?$/.exec(o.id);
          if (m) {
            const createdMs = parseInt(m[1]!, 10);
            if (Number.isFinite(createdMs) && nowMs - createdMs > 5_000) {
              toRemove.push(o.id);
            }
          }
        }
      }

      for (const id of toRemove) state.removeOrder(id);
    };

    tick();
    const interval = setInterval(tick, 5_000);
    return () => clearInterval(interval);
  }, []);

  const currentTrigger: OrderTrigger | null = useMemo(() => {
    if (trigger === 'at_time') {
      if (!atTimeValue) return null;
      const timeSec = Math.floor(new Date(atTimeValue).getTime() / 1000);
      if (!Number.isFinite(timeSec)) return null;
      return { type: 'AT_TIME', time: timeSec };
    }
    if (trigger === 'after_duration') {
      return { type: 'AFTER_DURATION', duration: afterDurationMin * 60 };
    }
    if (atWaypointId === '') return null;
    return { type: 'AT_WAYPOINT', waypointOrderId: atWaypointId };
  }, [trigger, atTimeValue, afterDurationMin, atWaypointId]);

  const validation = currentTrigger ? validateLeadTime(currentTrigger, now) : { ok: false };
  const leadError = !validation.ok && currentTrigger !== null && currentTrigger.type !== 'AT_WAYPOINT'
    ? validation.error ?? null
    : null;
  const canAdd = validation.ok;

  const handleAddOrder = () => {
    if (!canAdd || !currentTrigger) return;
    const id = `order-${Date.now()}`;
    addOrder({
      id,
      type: 'CAP',
      trigger: currentTrigger,
      value: { heading: Number(capValue) },
      label: `Cap → ${capValue}°`,
    });
  };

  const handleCommit = () => {
    const nowMs = Date.now();
    const passedWaypoints = new Set<string>(); // TODO: wire real waypoint state once available
    const sent: string[] = [];
    let skipped = 0;
    for (const order of orderQueue) {
      // Already-committed orders (e.g. those applied via the router) were
      // dispatched at apply-time. Re-sending would either duplicate (WPT) or
      // get silently dropped (CAP/TWA de-dupe in the engine). Skip silently.
      if (order.committed) continue;
      if (isObsolete(order, nowMs, passedWaypoints)) {
        skipped += 1;
        continue;
      }
      sendOrder({ type: order.type, value: order.value, trigger: order.trigger });
      sent.push(order.id);
    }
    for (const id of sent) removeOrder(id);
    if (skipped > 0) {
      setToast({
        message: `${sent.length} ordre${sent.length > 1 ? 's' : ''} envoyé${sent.length > 1 ? 's' : ''}, ${skipped} ignoré${skipped > 1 ? 's' : ''} (obsolète${skipped > 1 ? 's' : ''})`,
        type: 'warning',
      });
    } else if (sent.length > 0) {
      setToast({
        message: `${sent.length} ordre${sent.length > 1 ? 's' : ''} envoyé${sent.length > 1 ? 's' : ''}`,
        type: 'success',
      });
    }
  };

  // Pending = orders that "Valider la file" will actually send.
  const pendingCount = orderQueue.filter((o) => !o.committed).length;

  // Lookup so AT_WAYPOINT triggers can display the predecessor's friendly
  // label ("WP 1") instead of the raw uid stored in waypointOrderId.
  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orderQueue) m.set(o.id, o.label);
    return m;
  }, [orderQueue]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'cap', label: 'Cap' },
    { id: 'waypoints', label: 'Waypoints' },
    { id: 'sails', label: 'Voiles' },
  ];

  return (
    <div>
      {/* Tabs */}
      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Form */}
      {activeTab === 'cap' && (
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Quand</label>
            <select
              className={styles.fieldInput}
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as TriggerKind)}
            >
              <option value="at_time">À une heure précise</option>
              <option value="at_waypoint">À un waypoint</option>
              <option value="after_duration">Après une durée</option>
            </select>
          </div>

          {trigger === 'at_time' && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Heure cible (≥ 5 min)</label>
              <input
                type="datetime-local"
                className={`${styles.fieldInput} ${leadError ? styles.fieldInputError : ''}`}
                value={atTimeValue}
                onChange={(e) => setAtTimeValue(e.target.value)}
              />
              {leadError && <span className={styles.fieldError}>{leadError}</span>}
            </div>
          )}

          {trigger === 'after_duration' && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Dans (minutes, min 5)</label>
              <input
                type="number"
                min={5}
                className={`${styles.fieldInput} ${leadError ? styles.fieldInputError : ''}`}
                value={afterDurationMin}
                onChange={(e) => setAfterDurationMin(Number(e.target.value))}
              />
              {leadError && <span className={styles.fieldError}>{leadError}</span>}
            </div>
          )}

          {trigger === 'at_waypoint' && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Waypoint</label>
              <input
                type="text"
                className={styles.fieldInput}
                value={atWaypointId}
                onChange={(e) => setAtWaypointId(e.target.value)}
                placeholder="ID du waypoint"
              />
            </div>
          )}

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Cap cible</label>
              <input
                className={styles.fieldInput}
                value={capValue}
                onChange={(e) => setCapValue(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Lock TWA</label>
              <select className={styles.fieldInput}>
                <option>Désactivé</option>
                <option>Activé</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            className={styles.submit}
            onClick={handleAddOrder}
            disabled={!canAdd}
          >
            Ajouter à la file
          </button>
        </div>
      )}

      {activeTab === 'waypoints' && (
        <div className={styles.empty}>Waypoints — à venir</div>
      )}

      {activeTab === 'sails' && (
        <div className={styles.empty}>Programmation voiles — à venir</div>
      )}

      {/* Order queue */}
      <h4 className={styles.queueTitle}>
        File d&apos;ordres{' '}
        <span className={styles.queueCount}>{String(orderQueue.length).padStart(2, '0')} actifs</span>
      </h4>
      {orderQueue.length === 0 ? (
        <div className={styles.empty}>Aucun ordre programmé</div>
      ) : (
        <div className={styles.queue}>
          {orderQueue.map((o) => {
            const committed = o.committed === true;
            // Stale only matters for not-yet-sent orders; committed ones are
            // already on the server and out of the user's hands.
            const stale = !committed && isStale(o.trigger, now);
            const cls = `${styles.order} ${stale ? styles.orderStale : ''} ${committed ? styles.orderCommitted : ''}`;
            return (
              <div key={o.id} className={cls}>
                <span className={styles.orderWhen}>{formatTrigger(o.trigger, labelById)}</span>
                <span className={styles.orderWhat}>
                  {o.label}
                  {committed && <span className={styles.orderCommittedBadge}> ✓ envoyé</span>}
                  {stale && <span className={styles.orderStaleBadge}> ⚠ bientôt obsolète</span>}
                </span>
                <button
                  type="button"
                  className={styles.orderDel}
                  onClick={() => removeOrder(o.id)}
                  aria-label="Supprimer"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {pendingCount > 0 && (
        <button type="button" className={styles.commit} onClick={handleCommit}>
          Valider la file ({pendingCount})
        </button>
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
