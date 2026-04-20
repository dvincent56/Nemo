// apps/web/src/lib/mapAppearance.ts

export type OceanPreset = {
  id: string;
  label: string;
  color: string;
};

export type LandPreset = {
  id: string;
  label: string;
  tileUrl: string;
};

export const OCEAN_PRESETS: readonly OceanPreset[] = [
  { id: 'deep-night', label: 'Nuit profonde', color: '#0a2035' },
  { id: 'royal-blue', label: 'Bleu roi',      color: '#1a3a5c' },
  { id: 'glacier',    label: 'Bleu glacier',  color: '#c3d4e0' },
  { id: 'ivory',      label: 'Ivoire',        color: '#f5f0e8' },
] as const;

export const LAND_PRESETS: readonly LandPreset[] = [
  { id: 'dark',     label: 'Sombre',    tileUrl: 'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'light',    label: 'Clair',     tileUrl: 'https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'pastel',   label: 'Pastel',    tileUrl: 'https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png' },
  { id: 'contrast', label: 'Contraste', tileUrl: 'https://basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}@2x.png' },
] as const;

export const DEFAULT_OCEAN_ID = 'deep-night';
export const DEFAULT_LAND_ID = 'dark';
export const STORAGE_KEY = 'nemo.mapAppearance';

// ── Self-check at module load — catches catalog typos in dev ──
function validateCatalogs(): void {
  const oceanIds = new Set<string>();
  for (const p of OCEAN_PRESETS) {
    if (oceanIds.has(p.id)) throw new Error(`Duplicate ocean preset id: ${p.id}`);
    oceanIds.add(p.id);
    if (!/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error(`Invalid hex for ${p.id}: ${p.color}`);
  }
  const landIds = new Set<string>();
  for (const p of LAND_PRESETS) {
    if (landIds.has(p.id)) throw new Error(`Duplicate land preset id: ${p.id}`);
    landIds.add(p.id);
    if (!/\{z\}/.test(p.tileUrl) || !/\{x\}/.test(p.tileUrl) || !/\{y\}/.test(p.tileUrl)) {
      throw new Error(`Invalid tileUrl for ${p.id}: ${p.tileUrl}`);
    }
  }
  if (!oceanIds.has(DEFAULT_OCEAN_ID)) throw new Error(`DEFAULT_OCEAN_ID not in catalog: ${DEFAULT_OCEAN_ID}`);
  if (!landIds.has(DEFAULT_LAND_ID)) throw new Error(`DEFAULT_LAND_ID not in catalog: ${DEFAULT_LAND_ID}`);
}
validateCatalogs();

export function findOceanPreset(id: string): OceanPreset | undefined {
  return OCEAN_PRESETS.find((p) => p.id === id);
}

export function findLandPreset(id: string): LandPreset | undefined {
  return LAND_PRESETS.find((p) => p.id === id);
}
