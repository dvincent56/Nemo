'use client';
// apps/web/src/app/dev/simulator/OrderInput.tsx

import { useState } from 'react';
import styles from './OrderInput.module.css';
import type { SimOrder, SimOrderKind } from '@/lib/simulator/types';
import type { SailId } from '@nemo/shared-types';

interface Props {
  availableSails: SailId[];
  onSubmit(order: SimOrder): void;
  disabled?: boolean;
}

type FormState =
  | { kind: 'CAP'; value: number }
  | { kind: 'TWA'; value: number }
  | { kind: 'SAIL'; value: SailId }
  | { kind: 'MODE'; value: boolean };

export function OrderInput({ availableSails, onSubmit, disabled }: Props) {
  const [form, setForm] = useState<FormState>({ kind: 'CAP', value: 90 });

  function setKind(kind: SimOrderKind) {
    if (kind === 'CAP') setForm({ kind, value: 90 });
    else if (kind === 'TWA') setForm({ kind, value: 120 });
    else if (kind === 'SAIL') setForm({ kind, value: availableSails[0] ?? 'JIB' });
    else setForm({ kind, value: true });
  }

  function submit() {
    onSubmit({ kind: form.kind, value: form.value });
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Ordre à tous les bateaux</div>
      <div className={styles.kindRow}>
        {(['CAP', 'TWA', 'SAIL', 'MODE'] as const).map(k => (
          <button
            key={k}
            className={k === form.kind ? styles.kindActive : styles.kindBtn}
            onClick={() => setKind(k)}
            disabled={disabled}
          >{k}</button>
        ))}
      </div>
      <div className={styles.valueRow}>
        {form.kind === 'CAP' && (
          <>
            <input
              type="number" min={0} max={359}
              value={form.value}
              onChange={e => setForm({ kind: 'CAP', value: Math.max(0, Math.min(359, Number(e.target.value) || 0)) })}
              disabled={disabled}
            />
            <span className={styles.unit}>°</span>
          </>
        )}
        {form.kind === 'TWA' && (
          <>
            <input
              type="number" min={-180} max={180}
              value={form.value}
              onChange={e => setForm({ kind: 'TWA', value: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) })}
              disabled={disabled}
            />
            <span className={styles.unit}>°</span>
          </>
        )}
        {form.kind === 'SAIL' && (
          <select
            value={form.value as string}
            onChange={e => setForm({ kind: 'SAIL', value: e.target.value as SailId })}
            disabled={disabled}
          >
            {availableSails.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {form.kind === 'MODE' && (
          <label className={styles.modeLabel}>
            <input
              type="checkbox"
              checked={form.value as boolean}
              onChange={e => setForm({ kind: 'MODE', value: e.target.checked })}
              disabled={disabled}
            />
            Auto-voile
          </label>
        )}
      </div>
      <button className={styles.submitBtn} onClick={submit} disabled={disabled}>
        OK — envoyer à tous
      </button>
    </div>
  );
}
