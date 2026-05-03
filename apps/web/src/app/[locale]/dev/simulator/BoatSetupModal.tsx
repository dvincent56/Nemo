'use client';
// apps/web/src/app/dev/simulator/BoatSetupModal.tsx

import { useState, useId } from 'react';
import type { BoatClass, SailId } from '@nemo/shared-types';
import { resolveBoatLoadout } from '@nemo/game-engine-core/browser';
import type { UpgradeItem, UpgradeSlot } from '@nemo/game-balance/browser';
import type { SimBoatSetup } from '@/lib/simulator/types';
// Import game-balance catalog statically — Next.js/webpack resolves this via transpilePackages
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GB = require('@nemo/game-balance/config') as {
  upgrades: {
    slots: UpgradeSlot[];
    slotsByClass: Record<BoatClass, Record<UpgradeSlot, 'open' | 'monotype' | 'absent'>>;
    items: UpgradeItem[];
  };
};
import { BOAT_CLASS_ORDER, CLASS_LABEL as CLASS_LABELS } from '@/lib/boat-classes';
import styles from './BoatSetupModal.module.css';

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_CLASSES: readonly BoatClass[] = BOAT_CLASS_ORDER;

const SLOT_LABELS: Record<UpgradeSlot, string> = {
  HULL: 'Coque',
  MAST: 'Mât',
  SAILS: 'Voiles',
  FOILS: 'Foils',
  KEEL: 'Quille',
  ELECTRONICS: 'Électronique',
  REINFORCEMENT: 'Renforcement',
};

const TIER_ORDER: Record<string, number> = {
  SERIE: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PROTO: 4,
};

const TIER_LABELS: Record<string, string> = {
  SERIE: 'Série',
  BRONZE: 'Bronze',
  SILVER: 'Argent',
  GOLD: 'Or',
  PROTO: 'Proto',
};

// All sails — all classes share the same set
const ALL_SAILS: { id: SailId; label: string }[] = [
  { id: 'JIB',  label: 'Foc' },
  { id: 'LJ',   label: 'Light Jib' },
  { id: 'SS',   label: 'Storm Sail' },
  { id: 'C0',   label: 'Code 0' },
  { id: 'SPI',  label: 'Spinnaker' },
  { id: 'HG',   label: 'Heavy Gennaker' },
  { id: 'LG',   label: 'Light Gennaker' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `boat-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Get items for a given class+slot, sorted by tier, skipping absent slots */
function getSlotItems(boatClass: BoatClass, slot: UpgradeSlot): UpgradeItem[] | null {
  const avail = GB.upgrades.slotsByClass[boatClass]?.[slot];
  if (avail === 'absent') return null;

  const items = GB.upgrades.items.filter(
    (item) => item.slot === slot && item.compat.includes(boatClass as never),
  );
  items.sort((a, b) => (TIER_ORDER[a.tier] ?? 99) - (TIER_ORDER[b.tier] ?? 99));
  return items;
}

/** Default slot selections for a class: SERIE item id per slot */
function defaultSlotSelections(boatClass: BoatClass): Record<UpgradeSlot, string> {
  const result: Record<UpgradeSlot, string> = {
    HULL: '', MAST: '', SAILS: '', FOILS: '', KEEL: '', ELECTRONICS: '', REINFORCEMENT: '',
  };
  for (const slot of GB.upgrades.slots) {
    const items = getSlotItems(boatClass, slot);
    if (!items || items.length === 0) continue;
    const serie = items.find((i) => i.tier === 'SERIE') ?? items[0];
    if (serie) result[slot] = serie.id;
  }
  return result;
}

/** Build slot selections from an existing BoatLoadout */
function selectionsFromLoadout(
  loadout: SimBoatSetup['loadout'],
  boatClass: BoatClass,
): Record<UpgradeSlot, string> {
  const defaults = defaultSlotSelections(boatClass);
  for (const [slot, item] of loadout.bySlot) {
    defaults[slot as UpgradeSlot] = item.id;
  }
  return defaults;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface BoatSetupModalProps {
  initial: SimBoatSetup | null;
  onClose(): void;
  onSave(setup: SimBoatSetup): void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function BoatSetupModal({ initial, onClose, onSave }: BoatSetupModalProps) {
  const uid = useId();

  // ── Local state ──────────────────────────────────────────────────────────
  const [name, setName] = useState(initial?.name ?? '');
  const [boatClass, setBoatClass] = useState<BoatClass>(initial?.boatClass ?? 'CLASS40');
  const [sail, setSail] = useState<SailId>(initial?.initialSail ?? 'JIB');

  const [slotSelections, setSlotSelections] = useState<Record<UpgradeSlot, string>>(
    () =>
      initial
        ? selectionsFromLoadout(initial.loadout, initial.boatClass)
        : defaultSlotSelections('CLASS40'),
  );

  const [hull, setHull] = useState(initial?.initialCondition.hull ?? 100);
  const [rig, setRig] = useState(initial?.initialCondition.rig ?? 100);
  const [sails, setSails] = useState(initial?.initialCondition.sails ?? 100);
  const [electronics, setElectronics] = useState(initial?.initialCondition.electronics ?? 100);

  // ── When class changes, reset slot selections ────────────────────────────
  function handleClassChange(newClass: BoatClass) {
    setBoatClass(newClass);
    setSlotSelections(defaultSlotSelections(newClass));
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  function handleSave() {
    const id = initial?.id ?? generateId();
    const finalName = name.trim() || `Bateau ${id.slice(-4)}`;

    // Collect installed items (non-SERIE choices that exist in catalog)
    const installed: UpgradeItem[] = [];
    for (const slot of GB.upgrades.slots) {
      const selectedId = slotSelections[slot];
      if (!selectedId) continue;
      const item = GB.upgrades.items.find((i) => i.id === selectedId);
      if (!item) continue;
      // Include ALL items (even SERIE) so resolveBoatLoadout has them;
      // it filters by availability itself
      installed.push(item);
    }

    let loadout: SimBoatSetup['loadout'];
    try {
      loadout = resolveBoatLoadout(id, installed, boatClass);
    } catch (err) {
      // Fallback: empty loadout (shouldn't happen with valid catalog data)
      console.error('resolveBoatLoadout error:', err);
      loadout = { participantId: id, bySlot: new Map(), items: [] };
    }

    const setup: SimBoatSetup = {
      id,
      name: finalName,
      boatClass,
      loadout,
      initialSail: sail,
      initialCondition: {
        hull: clamp(hull),
        rig: clamp(rig),
        sails: clamp(sails),
        electronics: clamp(electronics),
      },
    };

    onSave(setup);
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.dialogHeader}>
          <p className={styles.dialogTitle}>
            {initial ? 'Modifier le bateau' : 'Ajouter un bateau'}
          </p>
          <button className={styles.btnClose} onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className={styles.dialogBody}>
          {/* Name */}
          <div className={styles.group}>
            <label className={styles.label} htmlFor={`${uid}-name`}>
              Nom
            </label>
            <input
              id={`${uid}-name`}
              className={styles.input}
              type="text"
              placeholder="ex. Bateau 1"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Class */}
          <div className={styles.group}>
            <label className={styles.label} htmlFor={`${uid}-class`}>
              Classe
            </label>
            <select
              id={`${uid}-class`}
              className={styles.select}
              value={boatClass}
              onChange={(e) => handleClassChange(e.target.value as BoatClass)}
            >
              {ALL_CLASSES.map((cls) => (
                <option key={cls} value={cls}>
                  {CLASS_LABELS[cls]}
                </option>
              ))}
            </select>
          </div>

          {/* Initial sail */}
          <div className={styles.group}>
            <label className={styles.label} htmlFor={`${uid}-sail`}>
              Voile initiale
            </label>
            <select
              id={`${uid}-sail`}
              className={styles.select}
              value={sail}
              onChange={(e) => setSail(e.target.value as SailId)}
            >
              {ALL_SAILS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} — {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Loadout */}
          <div>
            <p className={styles.loadoutTitle}>Équipements</p>
            <div className={styles.loadoutGrid}>
              {GB.upgrades.slots.map((slot) => {
                const items = getSlotItems(boatClass, slot);
                const avail = GB.upgrades.slotsByClass[boatClass]?.[slot];

                if (avail === 'absent') {
                  return (
                    <div key={slot} className={styles.slotRow}>
                      <span className={styles.slotLabel}>{SLOT_LABELS[slot]}</span>
                      <span className={styles.slotAbsent}>— absent sur cette classe</span>
                    </div>
                  );
                }

                if (avail === 'monotype' && items && items.length === 1) {
                  return (
                    <div key={slot} className={styles.slotRow}>
                      <span className={styles.slotLabel}>{SLOT_LABELS[slot]}</span>
                      <span className={styles.slotMonotype}>
                        {items[0]?.name ?? 'Monotype'} (monotype)
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={slot} className={styles.slotRow}>
                    <span className={styles.slotLabel}>{SLOT_LABELS[slot]}</span>
                    <select
                      className={styles.select}
                      value={slotSelections[slot] ?? ''}
                      onChange={(e) =>
                        setSlotSelections((prev) => ({ ...prev, [slot]: e.target.value }))
                      }
                    >
                      {(items ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {TIER_LABELS[item.tier] ?? item.tier} — {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Conditions */}
          <div>
            <p className={styles.loadoutTitle}>Conditions initiales</p>
            <div className={styles.conditionsGrid}>
              <div className={styles.condGroup}>
                <span className={styles.condLabel}>Coque</span>
                <input
                  type="number"
                  className={styles.condInput}
                  min={0}
                  max={100}
                  value={hull}
                  onChange={(e) => setHull(Number(e.target.value))}
                />
              </div>
              <div className={styles.condGroup}>
                <span className={styles.condLabel}>Gréement</span>
                <input
                  type="number"
                  className={styles.condInput}
                  min={0}
                  max={100}
                  value={rig}
                  onChange={(e) => setRig(Number(e.target.value))}
                />
              </div>
              <div className={styles.condGroup}>
                <span className={styles.condLabel}>Voiles</span>
                <input
                  type="number"
                  className={styles.condInput}
                  min={0}
                  max={100}
                  value={sails}
                  onChange={(e) => setSails(Number(e.target.value))}
                />
              </div>
              <div className={styles.condGroup}>
                <span className={styles.condLabel}>Électro</span>
                <input
                  type="number"
                  className={styles.condInput}
                  min={0}
                  max={100}
                  value={electronics}
                  onChange={(e) => setElectronics(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.dialogFooter}>
          <button className={styles.btnCancel} onClick={onClose}>
            Annuler
          </button>
          <button className={styles.btnSave} onClick={handleSave}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Utilities ────────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.min(100, Math.max(0, Math.round(v)));
}
