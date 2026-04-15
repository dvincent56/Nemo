'use client';

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { CLASS_LABEL, type BoatDetail } from '../../data';
import styles from './page.module.css';

/* =========================================================================
   État de personnalisation — schéma local, à mapper sur la future table
   `boat_customizations` (cf. memory project_backend_schema_gaps — colonnes
   hull_pattern/sail_pattern/deck_color/hull_number + nouvelle table pour
   les dégradés et marquages complexes).
   ========================================================================= */

type ColorMode = 'solid' | 'gradient' | 'texture';
type ZoneId = 'hull' | 'mast' | 'appendages' | 'sails';

interface ZoneConfig {
  mode: ColorMode;
  solid: string;
  gradient: { c1: string; c2: string; angle: number };
  textureName: string | null;
}

interface MarkingConfig {
  sailText: string;
  sailTextColor: string;
  sailTextSize: 'S' | 'M' | 'L';
  sailCountryCode: string;
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

const PALETTE = [
  '#1a2840', '#1a4d7a', '#0c2a4a', '#c9a227',
  '#f5f0e8', '#2d8a4e', '#9e2a2a', '#4a5568',
];

const APPENDAGES_DEFAULT = '#c9a227';
const MAST_DEFAULT = '#1a2840';

function makeZone(solid: string, c2 = solid): ZoneConfig {
  return {
    mode: 'solid',
    solid,
    gradient: { c1: solid, c2, angle: 90 },
    textureName: null,
  };
}

function buildInitial(boat: BoatDetail): CustomizeState {
  return {
    name: boat.name,
    zones: {
      hull:       { mode: 'gradient', solid: boat.hullColor,
                    gradient: { c1: boat.hullColor, c2: darken(boat.hullColor, 0.35), angle: 90 },
                    textureName: null },
      mast:       makeZone(MAST_DEFAULT),
      appendages: makeZone(APPENDAGES_DEFAULT),
      sails:      { mode: 'gradient', solid: '#fbf7f0',
                    gradient: { c1: '#fbf7f0', c2: '#e4ddd0', angle: 180 },
                    textureName: null },
    },
    markings: {
      sailText: boat.hullNumber,
      sailTextColor: boat.hullColor,
      sailTextSize: 'M',
      sailCountryCode: 'FRA',
      hullText: boat.name.toUpperCase(),
      hullTextColor: '#f5f0e8',
      hullTextPosition: 'center',
      hullNumberSide: boat.hullNumber,
    },
  };
}

/** Assombrit une couleur hex pour générer la 2e stop d'un dégradé par défaut. */
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

export default function CustomizeView({ boat }: { boat: BoatDetail }): React.ReactElement {
  const initialRef = useRef<CustomizeState>(buildInitial(boat));
  const [state, setState] = useState<CustomizeState>(initialRef.current);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initialRef.current),
    [state],
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
  const updateMarkings = (patch: Partial<MarkingConfig>): void => {
    setState((s) => ({ ...s, markings: { ...s.markings, ...patch } }));
  };

  const handleReset = (): void => setState(initialRef.current);
  const handleCancel = (): void => setState(initialRef.current);
  const handleSave = (): void => {
    // TODO POST /api/v1/boats/:id/customization
    initialRef.current = state;
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2400);
  };

  return (
    <>
      <div className={styles.subhead}>
        <nav className={styles.breadcrumb} aria-label="Fil d'ariane">
          <Link href={'/marina' as Parameters<typeof Link>[0]['href']}>← Marina</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <Link href={`/marina/${boat.id}` as Parameters<typeof Link>[0]['href']}>{boat.name}</Link>
          <span className={styles.breadcrumbSep}>/</span>
          <span>Personnaliser</span>
        </nav>
      </div>

      <main className={styles.studio}>
        {/* ── Preview ───────────────────────────────────────────── */}
        <aside className={styles.preview}>
          <p className={styles.previewEyebrow}>Aperçu</p>
          <div className={styles.previewStage} aria-label="Aperçu du bateau personnalisé">
            <PreviewSvg state={state} boatId={boat.id} hullNumber={boat.hullNumber} />
          </div>
          <h1 className={styles.previewName}>{state.name || 'Sans nom'}</h1>
          <p className={styles.previewMeta}>
            {CLASS_LABEL[boat.boatClass]} · <strong>{state.markings.sailCountryCode}-{boat.hullNumber}</strong>
            {' · '}
            {dirty ? 'Aperçu non sauvegardé' : 'Configuration enregistrée'}
          </p>
          <div className={styles.actionBar}>
            <span className={`${styles.actionBarMsg} ${dirty ? styles.actionBarMsgDirty : ''}`}>
              {savedFlash ? '✓ Enregistré' : dirty ? 'Modifications en cours' : 'Aucune modification'}
            </span>
            <div className={styles.actionBarButtons}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`}
                      onClick={handleReset} disabled={!dirty}>
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

          {/* 02 · Coque */}
          <SectionCard num="02 · Coque" title="Coque">
            <ZonePicker
              zone={state.zones.hull}
              onChangeMode={(m) => updateZone('hull', { mode: m })}
              onChangeSolid={(c) => updateZone('hull', { solid: c })}
              onChangeGradient={(p) => updateZoneGradient('hull', p)}
              onChangeTexture={(name) => updateZone('hull', { textureName: name })}
              palette={PALETTE}
            />
          </SectionCard>

          {/* 03 · Mât */}
          <SectionCard num="03 · Mât" title="Mât & gréement">
            <ZonePicker
              zone={state.zones.mast}
              onChangeMode={(m) => updateZone('mast', { mode: m })}
              onChangeSolid={(c) => updateZone('mast', { solid: c })}
              onChangeGradient={(p) => updateZoneGradient('mast', p)}
              onChangeTexture={(name) => updateZone('mast', { textureName: name })}
              palette={PALETTE}
            />
          </SectionCard>

          {/* 04 · Appendices */}
          <SectionCard num="04 · Appendices" title="Foils & quille"
                       aside="Couleur appliquée à toutes les pièces immergées.">
            <ZonePicker
              zone={state.zones.appendages}
              onChangeMode={(m) => updateZone('appendages', { mode: m })}
              onChangeSolid={(c) => updateZone('appendages', { solid: c })}
              onChangeGradient={(p) => updateZoneGradient('appendages', p)}
              onChangeTexture={(name) => updateZone('appendages', { textureName: name })}
              palette={PALETTE}
            />
          </SectionCard>

          {/* 05 · Voiles */}
          <SectionCard num="05 · Voiles" title="Voiles"
                       aside="Couleur de fond. Le numéro et les marquages sont gérés en section 06.">
            <ZonePicker
              zone={state.zones.sails}
              onChangeMode={(m) => updateZone('sails', { mode: m })}
              onChangeSolid={(c) => updateZone('sails', { solid: c })}
              onChangeGradient={(p) => updateZoneGradient('sails', p)}
              onChangeTexture={(name) => updateZone('sails', { textureName: name })}
              palette={PALETTE}
            />
          </SectionCard>

          {/* 06 · Marquages */}
          <SectionCard num="06 · Marquages" title="Textes sur voile & coque"
                       aside="Numéros, sponsors fictifs, devises. Police imposée (Bebas Neue).">
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

function ZonePicker({
  zone, onChangeMode, onChangeSolid, onChangeGradient, onChangeTexture, palette,
}: {
  zone: ZoneConfig;
  onChangeMode: (m: ColorMode) => void;
  onChangeSolid: (c: string) => void;
  onChangeGradient: (p: Partial<ZoneConfig['gradient']>) => void;
  onChangeTexture: (name: string | null) => void;
  palette: string[];
}): React.ReactElement {
  const modes: { id: ColorMode; label: string }[] = [
    { id: 'solid', label: 'Uni' },
    { id: 'gradient', label: 'Dégradé' },
    { id: 'texture', label: 'Texture' },
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

      {zone.mode === 'texture' && (
        <TextureUpload
          currentName={zone.textureName}
          onUpload={onChangeTexture}
        />
      )}
    </>
  );
}

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
  // Sync external changes (palette click)
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

function TextureUpload({
  currentName, onUpload,
}: { currentName: string | null; onUpload: (name: string | null) => void }): React.ReactElement {
  const handleFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (f) onUpload(f.name);
  };
  return (
    <>
      <label className={styles.upload}>
        <span className={styles.uploadIcon}>↑</span>
        <p className={styles.uploadText}>
          {currentName ? currentName : 'Importer un sticker / livrée'}
        </p>
        <p className={styles.uploadHint}>PNG ou SVG · 2 Mo max · positionnement libre après import</p>
        <input type="file" accept="image/png,image/svg+xml" hidden onChange={handleFile} />
      </label>
      {currentName && (
        <button type="button" className={styles.uploadRemove} onClick={() => onUpload(null)}>
          Retirer la texture
        </button>
      )}
    </>
  );
}

function MarkingsForm({
  markings, onChange, palette,
}: {
  markings: MarkingConfig;
  onChange: (p: Partial<MarkingConfig>) => void;
  palette: string[];
}): React.ReactElement {
  return (
    <>
      <div className={styles.markingBlock}>
        <p className={styles.markingBlockTitle}>Sur la voile</p>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Texte principal</span>
          <input
            className={styles.fieldInput} maxLength={6} value={markings.sailText}
            onChange={(e) => onChange({ sailText: e.target.value.toUpperCase() })}
          />
          <span className={styles.fieldHint}>
            6 caractères max. Visible à grande distance — privilégier numéro ou sigle.
          </span>
        </label>
        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Couleur</span>
            <HexField value={markings.sailTextColor} onChange={(c) => onChange({ sailTextColor: c })} />
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Taille</span>
            <select
              className={styles.fieldSelect}
              value={markings.sailTextSize}
              onChange={(e) => onChange({ sailTextSize: e.target.value as MarkingConfig['sailTextSize'] })}
            >
              <option value="S">Petite</option>
              <option value="M">Grande</option>
              <option value="L">Très grande</option>
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Code pays (au-dessus du n°)</span>
          <input
            className={styles.fieldInput} maxLength={3}
            value={markings.sailCountryCode}
            onChange={(e) => onChange({ sailCountryCode: e.target.value.toUpperCase() })}
          />
        </label>
      </div>

      <div className={styles.markingBlock}>
        <p className={styles.markingBlockTitle}>Sur la coque</p>
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

      <div className={styles.markingBlock}>
        <p className={styles.markingBlockTitle}>Décor avancé</p>
        <p className={styles.fieldHint}>
          Import d'un sticker ou d'une livrée complète (image PNG/SVG).
          Disponible en Phase 4 — pour l'instant à simuler dans l'aperçu uniquement.
        </p>
      </div>
      {/* palette passée mais non utilisée ici — réservée si on veut réutiliser le composant */}
      <span hidden>{palette.length}</span>
    </>
  );
}

/* ─── Preview SVG ─────────────────────────────────────────────── */

function PreviewSvg({
  state, boatId, hullNumber,
}: { state: CustomizeState; boatId: string; hullNumber: string }): React.ReactElement {
  const { hull, mast, appendages, sails } = state.zones;
  const m = state.markings;

  const hullFill = zoneFill('hull', boatId, hull);
  const mastStroke = zoneSolidFill(mast); // un trait ne peut pas utiliser un linearGradient svg simplement
  const appFill = zoneFill('appendages', boatId, appendages);
  const sailFill = zoneFill('sails', boatId, sails);

  // Taille du texte voile
  const sailSize = m.sailTextSize === 'L' ? 26 : m.sailTextSize === 'S' ? 14 : 20;

  // Position X texte coque
  const hullTextX = m.hullTextPosition === 'fore' ? 110
                  : m.hullTextPosition === 'aft'  ? 210
                  : 160;

  return (
    <svg className={styles.previewSvg} viewBox="0 0 320 240" preserveAspectRatio="xMidYMid meet">
      <defs>
        {hull.mode === 'gradient' && (
          <linearGradient id={`hull-${boatId}`} gradientTransform={`rotate(${hull.gradient.angle})`}>
            <stop offset="0" stopColor={hull.gradient.c1} />
            <stop offset="1" stopColor={hull.gradient.c2} />
          </linearGradient>
        )}
        {sails.mode === 'gradient' && (
          <linearGradient id={`sails-${boatId}`} gradientTransform={`rotate(${sails.gradient.angle})`}>
            <stop offset="0" stopColor={sails.gradient.c1} />
            <stop offset="1" stopColor={sails.gradient.c2} />
          </linearGradient>
        )}
        {appendages.mode === 'gradient' && (
          <linearGradient id={`appendages-${boatId}`} gradientTransform={`rotate(${appendages.gradient.angle})`}>
            <stop offset="0" stopColor={appendages.gradient.c1} />
            <stop offset="1" stopColor={appendages.gradient.c2} />
          </linearGradient>
        )}
      </defs>

      <line x1="20" y1="190" x2="300" y2="190"
            stroke="#1a2840" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="2 4" />
      <path d="M 38,190 L 280,190 L 250,210 L 70,210 Z" fill={hullFill} />
      <path d="M 38,190 L 280,190 L 276,184 L 42,184 Z" fill="#f5f0e8" />
      <text x={hullTextX} y="205" fontFamily="Bebas Neue" fontSize="15"
            fill={m.hullTextColor} textAnchor="middle" letterSpacing="0.14em">
        {m.hullText}
      </text>
      <text x="62" y="201" fontFamily="Bebas Neue" fontSize="9"
            fill="#c9a227" letterSpacing="0.10em">{m.hullNumberSide || hullNumber}</text>
      <line x1="158" y1="190" x2="158" y2="22" stroke={mastStroke} strokeWidth="3" />
      <line x1="158" y1="100" x2="248" y2="108" stroke={mastStroke} strokeWidth="1.5" />
      <path d="M 160,22 L 246,108 L 160,96 Z" fill={sailFill} stroke="#1a2840" strokeWidth="0.6" />
      <text x="200" y={68 + sailSize / 3} fontFamily="Bebas Neue" fontSize={sailSize}
            fill={m.sailTextColor} textAnchor="middle">{m.sailText}</text>
      {m.sailCountryCode && (
        <text x="200" y={82 + sailSize / 3} fontFamily="Space Mono" fontSize="7"
              fill={m.sailTextColor} textAnchor="middle" fontWeight="700" letterSpacing="0.2em">
          {m.sailCountryCode}
        </text>
      )}
      <path d="M 156,22 L 156,96 L 88,148 Z" fill={sailFill}
            stroke="#1a2840" strokeWidth="0.6" opacity="0.94" />
      <path d="M 150,210 L 168,210 L 158,228 Z" fill={appFill} opacity="0.85" />
      <path d="M 90,206 Q 70,218 50,210" fill="none" stroke={appFill} strokeWidth="1.6" />
      <path d="M 226,206 Q 246,218 264,210" fill="none" stroke={appFill} strokeWidth="1.6" />
    </svg>
  );
}

function zoneFill(zoneKey: 'hull' | 'sails' | 'appendages', boatId: string, zone: ZoneConfig): string {
  if (zone.mode === 'gradient') return `url(#${zoneKey}-${boatId})`;
  if (zone.mode === 'texture' && zone.textureName) return '#8a7f6d';
  return zone.solid;
}

function zoneSolidFill(zone: ZoneConfig): string {
  if (zone.mode === 'gradient') return zone.gradient.c1;
  if (zone.mode === 'texture' && zone.textureName) return '#8a7f6d';
  return zone.solid;
}
