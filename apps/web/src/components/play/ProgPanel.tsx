'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/lib/store';
import styles from './ProgPanel.module.css';

type TabId = 'cap' | 'waypoints' | 'sails';

export default function ProgPanel(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<TabId>('cap');
  const [capValue, setCapValue] = useState('225');
  const [trigger, setTrigger] = useState('immediate');
  const orderQueue = useGameStore((s) => s.prog.orderQueue);
  const addOrder = useGameStore((s) => s.addOrder);
  const removeOrder = useGameStore((s) => s.removeOrder);

  // Enable edit mode when panel is open
  useEffect(() => {
    useGameStore.getState().setEditMode(true);
    return () => { useGameStore.getState().setEditMode(false); };
  }, []);

  const handleAddOrder = () => {
    const id = `order-${Date.now()}`;
    addOrder({
      id,
      type: 'CAP',
      trigger: { type: 'IMMEDIATE' },
      value: { heading: Number(capValue) },
      label: `Cap → ${capValue}°`,
    });
  };

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
            <select className={styles.fieldInput} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="immediate">Immédiatement</option>
              <option value="at_time">À une heure précise</option>
              <option value="at_waypoint">À un waypoint</option>
              <option value="after_duration">Après une durée</option>
            </select>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Cap cible</label>
              <input className={styles.fieldInput} value={capValue} onChange={(e) => setCapValue(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Lock TWA</label>
              <select className={styles.fieldInput}>
                <option>Désactivé</option>
                <option>Activé</option>
              </select>
            </div>
          </div>
          <button type="button" className={styles.submit} onClick={handleAddOrder}>
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
        File d'ordres <span className={styles.queueCount}>{String(orderQueue.length).padStart(2, '0')} actifs</span>
      </h4>

      {orderQueue.length === 0 ? (
        <div className={styles.empty}>Aucun ordre programmé</div>
      ) : (
        <div className={styles.queue}>
          {orderQueue.map((o) => (
            <div key={o.id} className={styles.order}>
              <span className={styles.orderWhen}>
                {o.trigger.type === 'IMMEDIATE' ? 'Immédiat' : o.trigger.type}
              </span>
              <span className={styles.orderWhat}>
                {o.label}
              </span>
              <button type="button" className={styles.orderDel} onClick={() => removeOrder(o.id)} aria-label="Supprimer">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
