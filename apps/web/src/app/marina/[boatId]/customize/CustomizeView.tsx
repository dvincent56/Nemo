'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { CLASS_LABEL, type BoatDetail } from '../../data';
import styles from './page.module.css';

/* =========================================================================
   Types
   ========================================================================= */

type ColorMode = 'solid' | 'gradient';
type PatternName = 'none' | 'stripes' | 'dots' | 'honeycomb';
type ZoneId = 'hull' | 'cabin' | 'mast' | 'appendages' | 'mainsail' | 'jib';

interface PatternConfig {
  name: PatternName;
  color: string;
}

interface ZoneConfig {
  mode: ColorMode;
  solid: string;
  gradient: { c1: string; c2: string; angle: number };
  pattern: PatternConfig;
}

interface MarkingConfig {
  mainsailText: string;
  mainsailTextColor: string;
  mainsailTextSize: 'S' | 'M' | 'L';
  mainsailCountryCode: string;
  jibText: string;
  jibTextColor: string;
  hullText: string;
  hullTextColor: string;
  hullTextPosition: 'center' | 'fore' | 'aft';
  hullNumberSide: string;
}

interface CustomizeState {
  name: string;
  zones: Record<ZoneId, ZoneConfig>;
  markings: MarkingConfig;
}

/* =========================================================================
   Constants
   ========================================================================= */

const PALETTE = [
  '#1a2840', '#1a4d7a', '#0c2a4a', '#c9a227',
  '#f5f0e8', '#2d8a4e', '#9e2a2a', '#4a5568',
  '#e85d3a', '#d4a574', '#3a7ca5', '#f2c94c',
];

const PATTERNS: { id: PatternName; label: string }[] = [
  { id: 'none', label: 'Aucun' },
  { id: 'stripes', label: 'Lignes' },
  { id: 'dots', label: 'Ronds' },
  { id: 'honeycomb', label: "Nid d'ab." },
];

const ZONE_ORDER: ZoneId[] = ['hull', 'cabin', 'mast', 'appendages', 'mainsail', 'jib'];

const ZONE_META: Record<ZoneId, { label: string; aside?: string; supportsPattern: boolean }> = {
  hull:        { label: 'Coque',          supportsPattern: true },
  cabin:       { label: 'Cabine',         supportsPattern: false },
  mast:        { label: 'Mât & gréement', supportsPattern: false },
  appendages:  { label: 'Foils & quille', aside: 'Couleur appliquée à toutes les pièces immergées.', supportsPattern: false },
  mainsail:    { label: 'Grande voile',   supportsPattern: true },
  jib:         { label: 'Foc / Génois',   supportsPattern: true },
};

/* ── IMOCA SVG path data ────────────────────────────────────── */

const IMOCA = {
  viewBox: '0 0 628.14 1004.8',
  hull: 'M627.54,824.31c-34.32-.36-70.32-.34-106.91-.03-51.14.43-103.42,1.42-153.84,2.71-27.1.69-53.66,1.46-79.22,2.27,2.71,13.69,5.11,29.29,6.17,44.57h-14.66c.14-7.25-.47-24.51-1.18-41.87-.03-.79-.06-1.59-.1-2.38-1.23.04-2.46.08-3.68.12-6.93.23-13.77.46-20.52.7-70.92,2.44-131.7,5.08-171.11,6.91-30.23,1.41-47.88,2.33-47.88,2.33v3.9h-16.77v1.22H.28c-.35.25-.39,1.82,0,2.05h17.54v25.14c.74.03,1.49.05,2.23.07-.01-1.14-.01-2.29-.01-3.45h13.3c0,.47-.03,1.85-.1,3.9,77.58,2.53,144.84,3.72,202.98,3.86.53.01,1.07.01,1.6,0,7.89.03,15.62.03,23.18.01,1.54-.01,3.07-.02,4.6-.02,9.53-.04,18.79-.11,27.78-.2,216.55-2.3,281.77-21.17,281.77-35.94,0-6-5.17-9.76-7.89-12.23,0,0,59.78-.66,60.28-.83.5-.17,1.05-1.94,0-2.81Z',
  appendages: 'M287.57,829.26c-1.69-8.44-3.49-16.16-5.18-22.64-2.71-10.37-5.13-17.56-6.31-19.45.06,2.92.34,9.61.69,18.09.31,7.21.68,15.72,1.03,24.32.04.79.07,1.59.1,2.38.71,17.36,1.32,34.62,1.18,41.87h14.66c-1.06-15.28-3.46-30.88-6.17-44.57ZM250.56,995.38v.03h-11.58c-20.34.34-35.9,2.3-35.9,4.66,0,2.61,18.97,4.73,42.39,4.73s42.38-2.12,42.38-4.73c0-2.41-16.28-4.41-37.29-4.69ZM250.56,995.38l10.21-116.41c5.96-.29,9.97-.85,9.97-1.49,0-.44-1.94-.85-5.14-1.16-1.53,0-3.06.01-4.6.02-7.56.02-15.29.02-23.18-.01-.53.01-1.07.01-1.6,0-3.13.3-5.03.71-5.03,1.15,0,.51,2.57.97,6.66,1.29l1.13,116.63c2.12-.03,4.28-.05,6.49-.05,1.72,0,3.42.01,5.09.03ZM20.05,872.02c.17,34.74,2.88,55.96,4.73,55.96,5.81,0,7.98-42.07,8.46-55.51.07-2.05.1-3.43.1-3.9h-13.3c0,1.16,0,2.31.01,3.45Z',
  cabin: 'M258.96,824.19c-1.87-.53-3.92-1.08-6.16-1.63-1.1-.28-2.24-.55-3.44-.82-2.83-.67-5.92-1.33-9.31-1.99-16.93-3.32-41.06-6.64-75.24-8.94-8.91-.6-18.51-1.13-28.84-1.58-.57-.02-1.15-.05-1.73-.08l-74.27,1.08v4.46h22.52v22.62c39.41-1.83,100.19-4.47,171.11-6.91,6.75-.24,13.59-.47,20.52-.7-2.85-1.4-7.59-3.35-15.16-5.51ZM115.9,825.29l-16.67,4.66v-9.33h16.67v4.67ZM163.67,828.18h-25.21l-5.67-9.78h25.11l6.77,6.78-1,3ZM171.67,828.18l-8.44-9.78,8.67-3.56,4.44,10.44-4.67,2.9Z',
  mast: 'M265.97,802.65l-11.62-2.8-4.04-.97c.24,2.28.46,4.44.68,6.48v.03c-.29-.02-.58-.04-.88-.06-.03-.01-.06-.01-.09-.01-7.07-.51-16.66-.99-27.92-1.43-27.3-16.45-64.06-36.9-64.06-36.9l-3.4,3.41s29.53,17.92,55.9,33.07c-8.65-.29-17.99-.56-27.74-.82h-.19c-71.61-1.87-165.01-2.77-165.01-2.77v10.96l42.37-.61,74.27-1.08,1.95-.02,31.46-.46,50.71-.73c8.3,4.69,15.91,8.87,21.69,11.81,3.39.66,6.48,1.32,9.31,1.99-3.3-2.87-11.1-7.97-20.83-13.95l22.68-.33c.66,6.3,1.2,11.38,1.59,15.1,2.24.55,4.29,1.1,6.16,1.63l8.12-8.68s-.39-4.51-1.11-12.86ZM195.82,272.5l31.05,279.74c2.31-47.82,3.01-94.26,2.53-138.03C208.44,208.21,183.94,0,170.6,0c-1.77,0,10,121.84,25.19,272.16.01.12.02.23.03.34Z',
  jib: 'M213.06,175.47c8.28,56.72,15.26,141.08,16.34,238.74.48,43.77-.22,90.21-2.53,138.03-.24,5-.5,10.01-.77,15.04-3.96,71.95-11.59,146.69-24.3,219.89l48.51,11.71,4.04,.97,11.62,2.8,10.8,2.61c-.35-8.48-.63-15.17-.69-18.09,1.18,1.89,3.6,9.08,6.31,19.45l84.4,20.37c50.42-1.29,102.7-2.28,153.84-2.71L213.06,175.47Z',
  mainsail: 'M250.31,798.88l-48.51-11.71c12.71-73.2,20.34-147.94,24.3-219.89.27-5.03.53-10.04.77-15.04l-31.05-279.74c0-.11-.02-.22-.03-.34L165.95,3.33h-71.41c0,39.55-72.59,412.29-72.59,785.92l6.22,7.26,154.44,6.14h.19c9.75.26,19.09.53,27.74.82-26.37-15.15-55.9-33.07-55.9-33.07l3.4-3.41s36.76,20.45,64.06,36.9c11.26.44,20.85.92,27.92,1.43.03,0,.06,0,.09.01l.88.03c-.22-2.04-.44-4.2-.68-6.48Z',
} as const;

/* =========================================================================
   Helpers
   ========================================================================= */

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const num = parseInt(h, 16);
  const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((num >> 8)  & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((num         & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function makeZone(solid: string): ZoneConfig {
  return {
    mode: 'solid',
    solid,
    gradient: { c1: solid, c2: darken(solid, 0.35), angle: 90 },
    pattern: { name: 'none', color: '#FFFFFF' },
  };
}

function buildInitial(boat: BoatDetail): CustomizeState {
  return {
    name: boat.name,
    zones: {
      hull: {
        mode: 'gradient', solid: boat.hullColor,
        gradient: { c1: boat.hullColor, c2: darken(boat.hullColor, 0.35), angle: 90 },
        pattern: { name: 'none', color: '#f5f0e8' },
      },
      cabin:      makeZone('#4a5568'),
      mast:       makeZone('#1a2840'),
      appendages: makeZone('#c9a227'),
      mainsail: {
        mode: 'gradient', solid: '#fbf7f0',
        gradient: { c1: '#fbf7f0', c2: '#e4ddd0', angle: 180 },
        pattern: { name: 'none', color: boat.hullColor },
      },
      jib: {
        mode: 'gradient', solid: '#fbf7f0',
        gradient: { c1: '#fbf7f0', c2: '#e4ddd0', angle: 180 },
        pattern: { name: 'none', color: boat.hullColor },
      },
    },
    markings: {
      mainsailText: boat.hullNumber,
      mainsailTextColor: boat.hullColor,
      mainsailTextSize: 'M',
      mainsailCountryCode: 'FRA',
      jibText: '',
      jibTextColor: boat.hullColor,
      hullText: boat.name.toUpperCase(),
      hullTextColor: '#f5f0e8',
      hullTextPosition: 'center',
      hullNumberSide: boat.hullNumber,
    },
  };
}

function buildBlank(currentName: string): CustomizeState {
  const white = '#FFFFFF';
  const blank = makeZone(white);
  return {
    name: currentName,
    zones: {
      hull: blank, cabin: makeZone(white), mast: makeZone(white),
      appendages: makeZone(white), mainsail: makeZone(white), jib: makeZone(white),
    },
    markings: {
      mainsailText: '', mainsailTextColor: white, mainsailTextSize: 'M',
      mainsailCountryCode: '', jibText: '', jibTextColor: white,
      hullText: '', hullTextColor: white, hullTextPosition: 'center', hullNumberSide: '',
    },
  };
}

/* =========================================================================
   Main component
   ========================================================================= */

export default function CustomizeView({ boat }: { boat: BoatDetail }): React.ReactElement {
  const [baseline, setBaseline] = useState<CustomizeState>(() => buildInitial(boat));
  const [state, setState] = useState<CustomizeState>(baseline);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(baseline),
    [state, baseline],
  );

  const blank = useMemo(() => buildBlank(state.name), [state.name]);
  const canReset = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(blank),
    [state, blank],
  );

  const updateZone = (id: ZoneId, patch: Partial<ZoneConfig>): void => {
    setState((s) => ({ ...s, zones: { ...s.zones, [id]: { ...s.zones[id], ...patch } } }));
  };
  const updateZoneGradient = (id: ZoneId, patch: Partial<ZoneConfig['gradient']>): void => {
    setState((s) => ({
      ...s,
      zones: { ...s.zones, [id]: { ...s.zones[id], gradient: { ...s.zones[id].gradient, ...patch } } },
    }));
  };
  const updateZonePattern = (id: ZoneId, patch: Partial<PatternConfig>): void => {
    setState((s) => ({
      ...s,
      zones: { ...s.zones, [id]: { ...s.zones[id], pattern: { ...s.zones[id].pattern, ...patch } } },
    }));
  };
  const updateMarkings = (patch: Partial<MarkingConfig>): void => {
    setState((s) => ({ ...s, markings: { ...s.markings, ...patch } }));
  };

  const handleReset = (): void => setState(buildBlank(state.name));
  const handleCancel = (): void => setState(baseline);
  const handleSave = (): void => {
    // TODO POST /api/v1/boats/:id/customization
    setBaseline(state);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2400);
  };

  return (
    <>
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label="Fil d'ariane">
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>← Marina</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <Link href={`/marina/${boat.id}` as Parameters<typeof Link>[0]['href']}>{baseline.name}</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>Personnaliser</span>
        </nav>
      </div>

      <main className={styles.studio}>
        {/* ── Preview ───────────────────────────────────────────── */}
        <aside className={styles.preview}>
          <p className={styles.previewEyebrow}>Aperçu</p>
          <div className={styles.previewStage} aria-label="Aperçu du bateau personnalisé">
            <ImocaPreview state={state} />
          </div>
          <h1 className={styles.previewName}>{state.name || 'Sans nom'}</h1>
          <p className={styles.previewMeta}>
            {CLASS_LABEL[boat.boatClass as keyof typeof CLASS_LABEL] ?? boat.boatClass} · <strong>{state.markings.mainsailCountryCode}-{boat.hullNumber}</strong>
            {' · '}
            {dirty ? 'Aperçu non sauvegardé' : 'Configuration enregistrée'}
          </p>
          <div className={styles.actionBar}>
            <span className={`${styles.actionBarMsg} ${dirty ? styles.actionBarMsgDirty : ''}`}>
              {savedFlash ? '✓ Enregistré' : dirty ? 'Modifications en cours' : 'Aucune modification'}
            </span>
            <div className={styles.actionBarButtons}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`}
                      onClick={handleReset} disabled={!canReset}>
                Réinitialiser
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={handleCancel} disabled={!dirty}>
                Annuler
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`}
                      onClick={handleSave} disabled={!dirty}>
                Enregistrer
              </button>
            </div>
          </div>
        </aside>

        {/* ── Controls ──────────────────────────────────────────── */}
        <section className={styles.controls} aria-label="Personnalisation">
          {/* 01 · Identité */}
          <SectionCard num="01 · Identité" title="Nom">
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Nom du bateau</span>
              <input
                className={styles.fieldInput}
                value={state.name}
                maxLength={20}
                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              />
              <span className={styles.fieldHint}>
                20 caractères max. Visible sur le pont, le palmarès et le classement.
              </span>
            </label>
          </SectionCard>

          {/* Zones 02–07 */}
          {ZONE_ORDER.map((id, i) => {
            const meta = ZONE_META[id];
            const num = String(i + 2).padStart(2, '0');
            return (
              <SectionCard key={id} num={`${num} · ${meta.label}`} title={meta.label} {...(meta.aside ? { aside: meta.aside } : {})}>
                <ZonePicker
                  zone={state.zones[id]}
                  onChangeMode={(m) => updateZone(id, { mode: m })}
                  onChangeSolid={(c) => updateZone(id, { solid: c })}
                  onChangeGradient={(p) => updateZoneGradient(id, p)}
                  palette={PALETTE}
                />
                {meta.supportsPattern && (
                  <PatternPicker
                    pattern={state.zones[id].pattern}
                    onChangeName={(n) => updateZonePattern(id, { name: n })}
                    onChangeColor={(c) => updateZonePattern(id, { color: c })}
                    palette={PALETTE}
                  />
                )}
              </SectionCard>
            );
          })}

          {/* 08 · Marquages */}
          <SectionCard num="08 · Marquages" title="Textes & marquages"
                       aside="Numéros, sponsors fictifs, devises.">
            <MarkingsForm
              markings={state.markings}
              onChange={updateMarkings}
              palette={PALETTE}
            />
          </SectionCard>
        </section>
      </main>
    </>
  );
}

/* ─── Sub-components ──────────────────────────────────────────── */

function SectionCard({
  num, title, aside, children,
}: {
  num: string;
  title: string;
  aside?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionCardHead}>
        <p className={styles.sectionCardNum}>{num}</p>
      </div>
      <h2 className={styles.sectionCardTitle}>{title}</h2>
      {aside && <p className={styles.sectionCardAside}>{aside}</p>}
      <div className={styles.sectionCardBody}>{children}</div>
    </div>
  );
}

/* ── Zone picker (solid / gradient) ───────────────────────────── */

function ZonePicker({
  zone, onChangeMode, onChangeSolid, onChangeGradient, palette,
}: {
  zone: ZoneConfig;
  onChangeMode: (m: ColorMode) => void;
  onChangeSolid: (c: string) => void;
  onChangeGradient: (p: Partial<ZoneConfig['gradient']>) => void;
  palette: string[];
}): React.ReactElement {
  const modes: { id: ColorMode; label: string }[] = [
    { id: 'solid', label: 'Uni' },
    { id: 'gradient', label: 'Dégradé' },
  ];
  return (
    <>
      <div className={styles.modeTabs} role="tablist">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={zone.mode === m.id}
            className={`${styles.modeTab} ${zone.mode === m.id ? styles.modeTabActive : ''}`}
            onClick={() => onChangeMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {zone.mode === 'solid' && (
        <HexPicker value={zone.solid} onChange={onChangeSolid} palette={palette} />
      )}

      {zone.mode === 'gradient' && (
        <>
          <div
            className={styles.gradientPreview}
            style={{ background: `linear-gradient(${zone.gradient.angle}deg, ${zone.gradient.c1}, ${zone.gradient.c2})` }}
          />
          <div className={styles.gradientRow}>
            <div className={styles.gradientStop}>
              <span className={styles.gradientStopLabel}>Couleur 1</span>
              <HexField value={zone.gradient.c1} onChange={(c) => onChangeGradient({ c1: c })} />
            </div>
            <div className={styles.gradientStop}>
              <span className={styles.gradientStopLabel}>Couleur 2</span>
              <HexField value={zone.gradient.c2} onChange={(c) => onChangeGradient({ c2: c })} />
            </div>
          </div>
          <div className={styles.gradientAngle}>
            <span className={styles.gradientStopLabel}>Angle</span>
            <input
              type="range" min={0} max={360} value={zone.gradient.angle}
              className={styles.gradientAngleInput}
              aria-label="Angle du dégradé"
              onChange={(e) => onChangeGradient({ angle: parseInt(e.target.value, 10) })}
            />
            <span className={styles.gradientAngleValue}>{zone.gradient.angle}°</span>
          </div>
          <div className={styles.pickerSwatches} aria-label="Palette couleur 1">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                className={`${styles.swatch} ${zone.gradient.c1.toLowerCase() === c.toLowerCase() ? styles.swatchActive : ''}`}
                style={{ background: c }}
                onClick={() => onChangeGradient({ c1: c })}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ── Pattern picker ───────────────────────────────────────────── */

function PatternPicker({
  pattern, onChangeName, onChangeColor, palette,
}: {
  pattern: PatternConfig;
  onChangeName: (n: PatternName) => void;
  onChangeColor: (c: string) => void;
  palette: string[];
}): React.ReactElement {
  return (
    <div className={styles.patternSection}>
      <p className={styles.patternTitle}>Motif</p>
      <div className={styles.patternGrid}>
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`${styles.patternOption} ${pattern.name === p.id ? styles.patternOptionActive : ''}`}
            onClick={() => onChangeName(p.id)}
            aria-label={`Motif ${p.label}`}
          >
            <PatternThumbnail name={p.id} color={pattern.color} />
            <span className={styles.patternLabel}>{p.label}</span>
          </button>
        ))}
      </div>
      {pattern.name !== 'none' && (
        <div className={styles.patternColorRow}>
          <span className={styles.gradientStopLabel}>Couleur du motif</span>
          <HexPicker value={pattern.color} onChange={onChangeColor} palette={palette} />
        </div>
      )}
    </div>
  );
}

function PatternThumbnail({ name, color }: { name: PatternName; color: string }): React.ReactElement {
  const bg = '#e8e4dc';
  return (
    <svg className={styles.patternThumb} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="4" fill={bg} />
      {name === 'stripes' && (
        <g stroke={color} strokeWidth="2.5" opacity="0.6">
          <line x1="0" y1="32" x2="32" y2="0" />
          <line x1="-8" y1="24" x2="24" y2="-8" />
          <line x1="8" y1="40" x2="40" y2="8" />
        </g>
      )}
      {name === 'dots' && (
        <g fill={color} opacity="0.6">
          <circle cx="8" cy="8" r="2.5" />
          <circle cx="24" cy="8" r="2.5" />
          <circle cx="16" cy="16" r="2.5" />
          <circle cx="8" cy="24" r="2.5" />
          <circle cx="24" cy="24" r="2.5" />
        </g>
      )}
      {name === 'honeycomb' && (
        <g stroke={color} strokeWidth="1.2" fill="none" opacity="0.6">
          <path d="M8,2 L14,5.5 V12.5 L8,16 L2,12.5 V5.5Z" />
          <path d="M20,10 L26,13.5 V20.5 L20,24 L14,20.5 V13.5Z" />
          <path d="M8,18 L14,21.5 V28.5 L8,32 L2,28.5 V21.5Z" />
        </g>
      )}
    </svg>
  );
}

/* ── Hex pickers ──────────────────────────────────────────────── */

function HexPicker({
  value, onChange, palette,
}: { value: string; onChange: (hex: string) => void; palette: string[] }): React.ReactElement {
  return (
    <div className={styles.picker}>
      <HexField value={value} onChange={onChange} />
      <div className={styles.pickerSwatches} aria-label="Palette de couleurs">
        {palette.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Couleur ${c}`}
            className={`${styles.swatch} ${value.toLowerCase() === c.toLowerCase() ? styles.swatchActive : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}

function HexField({
  value, onChange,
}: { value: string; onChange: (hex: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState(value.toUpperCase());
  if (value.toUpperCase() !== draft && isValidHex(value)) {
    setDraft(value.toUpperCase());
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value.toUpperCase();
    setDraft(v);
    if (isValidHex(v)) onChange(v);
  };
  return (
    <div className={styles.pickerHexRow}>
      <label className={styles.pickerHexChip} style={{ background: isValidHex(draft) ? draft : value }}>
        <input
          type="color"
          className={styles.pickerHexNative}
          value={isValidHex(draft) ? draft : value}
          onChange={(e) => { setDraft(e.target.value.toUpperCase()); onChange(e.target.value.toUpperCase()); }}
          aria-label="Sélecteur de couleur"
        />
      </label>
      <input
        className={styles.pickerHexInput}
        value={draft}
        maxLength={7}
        onChange={handleChange}
      />
    </div>
  );
}

/* ── Markings form ────────────────────────────────────────────── */

function MarkingsForm({
  markings, onChange,
}: {
  markings: MarkingConfig;
  onChange: (p: Partial<MarkingConfig>) => void;
  palette: string[];
}): React.ReactElement {
  return (
    <>
      {/* Grande voile */}
      <div className={styles.markingBlock}>
        <p className={styles.markingBlockTitle}>Grande voile</p>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Numéro de voile</span>
          <input
            className={styles.fieldInput} maxLength={6} value={markings.mainsailText}
            onChange={(e) => onChange({ mainsailText: e.target.value.toUpperCase() })}
          />
          <span className={styles.fieldHint}>
            6 caractères max. Visible à grande distance — privilégier numéro ou sigle.
          </span>
        </label>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Couleur</span>
            <HexField value={markings.mainsailTextColor} onChange={(c) => onChange({ mainsailTextColor: c })} />
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Taille</span>
            <select
              className={styles.fieldSelect}
              value={markings.mainsailTextSize}
              onChange={(e) => onChange({ mainsailTextSize: e.target.value as MarkingConfig['mainsailTextSize'] })}
            >
              <option value="S">Petite</option>
              <option value="M">Grande</option>
              <option value="L">Très grande</option>
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Code pays</span>
          <input
            className={styles.fieldInput} maxLength={3}
            value={markings.mainsailCountryCode}
            onChange={(e) => onChange({ mainsailCountryCode: e.target.value.toUpperCase() })}
          />
        </label>
      </div>

      {/* Foc */}
      <div className={styles.markingBlock}>
        <p className={styles.markingBlockTitle}>Foc / Génois</p>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Texte (sponsor / devise)</span>
          <input
            className={styles.fieldInput} maxLength={12} value={markings.jibText}
            onChange={(e) => onChange({ jibText: e.target.value.toUpperCase() })}
          />
          <span className={styles.fieldHint}>
            12 caractères max. Optionnel — laissez vide pour une voile neutre.
          </span>
        </label>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Couleur</span>
          <HexField value={markings.jibTextColor} onChange={(c) => onChange({ jibTextColor: c })} />
        </div>
      </div>

      {/* Coque */}
      <div className={styles.markingBlock}>
        <p className={styles.markingBlockTitle}>Coque</p>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Texte (sponsor / devise)</span>
          <input
            className={styles.fieldInput} maxLength={20}
            value={markings.hullText}
            onChange={(e) => onChange({ hullText: e.target.value.toUpperCase() })}
          />
          <span className={styles.fieldHint}>
            20 caractères max. Le nom du bateau est utilisé par défaut.
          </span>
        </label>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Couleur</span>
            <HexField value={markings.hullTextColor} onChange={(c) => onChange({ hullTextColor: c })} />
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Position</span>
            <select
              className={styles.fieldSelect}
              value={markings.hullTextPosition}
              onChange={(e) => onChange({ hullTextPosition: e.target.value as MarkingConfig['hullTextPosition'] })}
            >
              <option value="center">Centrée</option>
              <option value="fore">Avant</option>
              <option value="aft">Arrière</option>
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Numéro tribord</span>
          <input
            className={styles.fieldInput} maxLength={4}
            value={markings.hullNumberSide}
            onChange={(e) => onChange({ hullNumberSide: e.target.value })}
          />
        </label>
      </div>
    </>
  );
}

/* =========================================================================
   IMOCA Preview — renders the real SVG with dynamic fills
   ========================================================================= */

function getZoneFill(id: ZoneId, zone: ZoneConfig): string {
  if (zone.mode === 'gradient') return `url(#grad-${id})`;
  return zone.solid;
}

function ImocaPreview({ state }: { state: CustomizeState }): React.ReactElement {
  const z = state.zones;
  const m = state.markings;

  const mainsailFontSize = m.mainsailTextSize === 'L' ? 80 : m.mainsailTextSize === 'S' ? 40 : 60;

  const hullTextX = m.hullTextPosition === 'fore' ? 480
                   : m.hullTextPosition === 'aft' ? 160
                   : 370;

  return (
    <svg
      className={styles.previewSvg}
      viewBox={IMOCA.viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-label={`Aperçu IMOCA — ${state.name}`}
    >
      <defs>
        {/* Gradient defs */}
        {ZONE_ORDER.map((id) => {
          const zone = z[id];
          if (zone.mode !== 'gradient') return null;
          return (
            <linearGradient key={`g-${id}`} id={`grad-${id}`}
              gradientTransform={`rotate(${zone.gradient.angle}, 0.5, 0.5)`}>
              <stop offset="0%" stopColor={zone.gradient.c1} />
              <stop offset="100%" stopColor={zone.gradient.c2} />
            </linearGradient>
          );
        })}

        {/* Pattern defs */}
        {(['hull', 'mainsail', 'jib'] as const).map((id) => {
          const p = z[id].pattern;
          if (p.name === 'none') return null;
          return <SvgPatternDef key={`p-${id}`} zoneId={id} patternName={p.name} color={p.color} />;
        })}
      </defs>

      {/* Water line hint */}
      <line x1="0" y1="840" x2="628" y2="840"
            stroke="#1a2840" strokeOpacity="0.10" strokeWidth="1" strokeDasharray="4 8" />

      {/* ── Zone paths (render order: back to front) ── */}

      {/* Grande voile (mainsail) */}
      <path d={IMOCA.mainsail} fill={getZoneFill('mainsail', z.mainsail)} />
      {z.mainsail.pattern.name !== 'none' && (
        <path d={IMOCA.mainsail} fill={`url(#pat-${z.mainsail.pattern.name}-mainsail)`} opacity="0.35" />
      )}

      {/* Petite voile (jib) */}
      <path d={IMOCA.jib} fill={getZoneFill('jib', z.jib)} />
      {z.jib.pattern.name !== 'none' && (
        <path d={IMOCA.jib} fill={`url(#pat-${z.jib.pattern.name}-jib)`} opacity="0.35" />
      )}

      {/* Mât */}
      <path d={IMOCA.mast} fill={getZoneFill('mast', z.mast)} />

      {/* Coque */}
      <path d={IMOCA.hull} fill={getZoneFill('hull', z.hull)} />
      {z.hull.pattern.name !== 'none' && (
        <path d={IMOCA.hull} fill={`url(#pat-${z.hull.pattern.name}-hull)`} opacity="0.35" />
      )}

      {/* Cabine */}
      <path d={IMOCA.cabin} fill={getZoneFill('cabin', z.cabin)} />

      {/* Appendices */}
      <path d={IMOCA.appendages} fill={getZoneFill('appendages', z.appendages)} />

      {/* ── Text markings ── */}

      {/* Mainsail number */}
      {m.mainsailText && (
        <text x="155" y="380" fontFamily="var(--font-display)" fontSize={mainsailFontSize}
              fill={m.mainsailTextColor} textAnchor="middle" letterSpacing="0.08em"
              transform="rotate(-5, 155, 380)">
          {m.mainsailText}
        </text>
      )}
      {m.mainsailCountryCode && (
        <text x="155" y={380 + mainsailFontSize * 0.65} fontFamily="var(--font-mono)" fontSize="22"
              fill={m.mainsailTextColor} textAnchor="middle" fontWeight="700" letterSpacing="0.20em"
              transform="rotate(-5, 155, 380)">
          {m.mainsailCountryCode}
        </text>
      )}

      {/* Jib text */}
      {m.jibText && (
        <text x="280" y="460" fontFamily="var(--font-display)" fontSize="36"
              fill={m.jibTextColor} textAnchor="middle" letterSpacing="0.06em"
              transform="rotate(12, 280, 460)">
          {m.jibText}
        </text>
      )}

      {/* Hull text */}
      {m.hullText && (
        <text x={hullTextX} y="862" fontFamily="var(--font-display)" fontSize="22"
              fill={m.hullTextColor} textAnchor="middle" letterSpacing="0.14em">
          {m.hullText}
        </text>
      )}

      {/* Hull number (starboard) */}
      {m.hullNumberSide && (
        <text x="530" y="848" fontFamily="var(--font-mono)" fontSize="14"
              fill="#c9a227" letterSpacing="0.10em" fontWeight="700">
          {m.hullNumberSide}
        </text>
      )}
    </svg>
  );
}

/* ── SVG pattern definitions ──────────────────────────────────── */

function SvgPatternDef({
  zoneId, patternName, color,
}: { zoneId: string; patternName: PatternName; color: string }): React.ReactElement | null {
  const id = `pat-${patternName}-${zoneId}`;

  if (patternName === 'stripes') {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width="14" height="14"
               patternTransform="rotate(45)">
        <rect width="6" height="14" fill={color} />
      </pattern>
    );
  }

  if (patternName === 'dots') {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width="20" height="20">
        <circle cx="10" cy="10" r="4" fill={color} />
      </pattern>
    );
  }

  if (patternName === 'honeycomb') {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width="28" height="48.5">
        <path
          d="M14,0 L28,8.08 V24.25 L14,32.33 L0,24.25 V8.08Z"
          fill="none" stroke={color} strokeWidth="2"
        />
        <path
          d="M28,24.25 V40.42 L14,48.5 L0,40.42 V24.25"
          fill="none" stroke={color} strokeWidth="2"
        />
      </pattern>
    );
  }

  return null;
}
