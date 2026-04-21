export type OceanPreset = {
  id: string;
  label: string;
  color: string;
};

export const OCEAN_PRESETS: readonly OceanPreset[] = [
  { id: 'deep-night',    label: 'Nuit profonde',  color: '#0a2035' },
  { id: 'royal-blue',    label: 'Bleu roi',       color: '#1a3a5c' },
  { id: 'midnight',      label: 'Bleu nuit',      color: '#0d1b2a' },
  { id: 'slate',         label: 'Ardoise',        color: '#223548' },
  { id: 'deep-indigo',   label: 'Indigo profond', color: '#152a4e' },
] as const;

export const DEFAULT_OCEAN_ID = 'deep-night';
export const STORAGE_KEY = 'nemo.mapAppearance';

// ── Self-check at module load — catches catalog typos in dev ──
function validateCatalogs(): void {
  const oceanIds = new Set<string>();
  for (const p of OCEAN_PRESETS) {
    if (oceanIds.has(p.id)) throw new Error(`Duplicate ocean preset id: ${p.id}`);
    oceanIds.add(p.id);
    if (!/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error(`Invalid hex for ${p.id}: ${p.color}`);
  }
  if (!oceanIds.has(DEFAULT_OCEAN_ID)) throw new Error(`DEFAULT_OCEAN_ID not in catalog: ${DEFAULT_OCEAN_ID}`);
}
validateCatalogs();

export function findOceanPreset(id: string): OceanPreset | undefined {
  return OCEAN_PRESETS.find((p) => p.id === id);
}
