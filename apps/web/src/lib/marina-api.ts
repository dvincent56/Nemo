import { API_BASE } from './api';

export type BoatClass = 'FIGARO' | 'CLASS40' | 'OCEAN_FIFTY' | 'IMOCA60' | 'ULTIM';
export type UpgradeSlot = 'HULL' | 'MAST' | 'SAILS' | 'FOILS' | 'KEEL' | 'ELECTRONICS' | 'REINFORCEMENT';
export type UpgradeTier = 'SERIE' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PROTO';
export type SlotAvailability = 'open' | 'monotype' | 'absent';

export interface BoatRecord {
  id: string;
  name: string;
  boatClass: string;
  hullColor: string | null;
  deckColor?: string | null;
  generation: number;
  status: 'ACTIVE' | 'SOLD' | 'ARCHIVED';
  activeRaceId: string | null;
  racesCount: number;
  wins: number;
  podiums: number;
  top10Finishes: number;
  hullCondition: number;
  rigCondition: number;
  sailCondition: number;
  elecCondition: number;
  createdAt: string;
}

export interface InstalledUpgrade {
  slot: UpgradeSlot;
  playerUpgradeId: string;
  catalogId: string;
  name: string;
  tier: UpgradeTier;
  profile: string;
  effects: CatalogEffects | null;
}

export interface PassiveEffects {
  speedByTwa?: [number, number, number, number, number];
  speedByTws?: [number, number, number];
  wearMul?: { hull?: number; rig?: number; sail?: number; elec?: number };
}

export interface CatalogEffects {
  speedByTwa: [number, number, number, number, number];
  speedByTws: [number, number, number];
  wearMul?: { hull?: number; rig?: number; sail?: number; elec?: number };
  maneuverMul?: Record<string, { dur: number; speed: number }>;
  polarTargetsDeg: number | null;
  activation?: { minTws?: number; maxTws?: number };
  groundingLossMul: number | null;
  /** Effects applied regardless of activation window (e.g. foil drag in light wind). */
  passiveEffects?: PassiveEffects;
}

export interface CatalogItem {
  id: string;
  slot: UpgradeSlot;
  tier: UpgradeTier;
  name: string;
  profile: string;
  description: string;
  compat: BoatClass[];
  cost: number | null;
  effects: CatalogEffects;
  unlockCriteria?: {
    racesFinished?: number;
    avgRankPctMax?: number;
    top10Finishes?: number;
    currentStreak?: number;
    or?: boolean;
  };
}

export interface InventoryItem {
  id: string;
  upgradeCatalogId: string;
  name: string;
  slot: UpgradeSlot | null;
  tier: UpgradeTier | null;
  acquiredAt: string;
  acquisitionSource: string;
  installedOn: { boatId: string; slot: UpgradeSlot } | null;
}

export interface RepairBreakdown {
  hull: number;
  rig: number;
  sail: number;
  elec: number;
  total: number;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when we're actually sending JSON — Fastify parses
  // the body eagerly when the header is set, which breaks empty POST/DELETE.
  const hasBody = init?.body !== undefined && init.body !== null;
  const res = await fetch(new URL(path, API_BASE), {
    credentials: 'include',
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error ?? `API ${res.status}`), { status: res.status, body });
  }
  return res.json() as Promise<T>;
}

export async function fetchMyBoats(): Promise<{ boats: BoatRecord[]; credits: number }> {
  return apiFetch('/api/v1/players/me/boats');
}

export async function fetchBoatDetail(boatId: string): Promise<{
  boat: BoatRecord;
  installedUpgrades: InstalledUpgrade[];
  credits: number;
}> {
  return apiFetch(`/api/v1/boats/${boatId}`);
}

export async function fetchCatalog(boatClass?: string): Promise<{
  items: CatalogItem[];
  slots: UpgradeSlot[];
  slotsByClass: Record<string, Record<UpgradeSlot, SlotAvailability>>;
  tiers: Record<UpgradeTier, { maintenanceMul: number }>;
}> {
  const q = boatClass ? `?boatClass=${boatClass}` : '';
  return apiFetch(`/api/v1/upgrades/catalog${q}`);
}

export interface PlayerStats {
  racesFinished: number;
  wins: number;
  podiums: number;
  top10Finishes: number;
  avgRankPct: number;
  currentStreak: number;
}

export async function fetchMyUpgrades(): Promise<{
  inventory: InventoryItem[];
  credits: number;
  stats: PlayerStats;
}> {
  return apiFetch('/api/v1/players/me/upgrades');
}

export async function createBoat(boatClass: string, name: string) {
  return apiFetch<{ id: string; name: string; boatClass: string }>('/api/v1/boats', {
    method: 'POST',
    body: JSON.stringify({ boatClass, name }),
  });
}

export async function purchaseUpgrade(itemId: string) {
  return apiFetch<{ upgrade: { id: string }; creditsRemaining: number }>('/api/v1/upgrades/purchase', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

export async function installUpgrade(boatId: string, playerUpgradeId: string) {
  return apiFetch<{ ok: boolean; slot: string }>(`/api/v1/boats/${boatId}/install`, {
    method: 'POST',
    body: JSON.stringify({ playerUpgradeId }),
  });
}

export async function uninstallUpgrade(boatId: string, slot: string) {
  return apiFetch<{ ok: boolean; returnedToInventory: string }>(`/api/v1/boats/${boatId}/uninstall`, {
    method: 'POST',
    body: JSON.stringify({ slot }),
  });
}

export async function buyAndInstall(itemId: string, boatId: string) {
  return apiFetch<{ upgrade: { id: string }; installedOn: { boatId: string; slot: string }; creditsRemaining: number }>(
    '/api/v1/upgrades/buy-and-install',
    { method: 'POST', body: JSON.stringify({ itemId, boatId }) },
  );
}

export async function repairBoat(boatId: string) {
  return apiFetch<{ repaired: boolean; cost: RepairBreakdown; creditsRemaining: number }>(
    `/api/v1/boats/${boatId}/repair`,
    { method: 'POST' },
  );
}

export async function sellBoat(boatId: string) {
  return apiFetch<{
    sold: boolean;
    sellPrice: number;
    creditsAfter: number;
    returnedUpgrades: { playerUpgradeId: string; catalogId: string; name: string; tier: string }[];
  }>(`/api/v1/boats/${boatId}`, { method: 'DELETE' });
}

export async function sellUpgrade(playerUpgradeId: string) {
  return apiFetch<{
    sold: boolean;
    refund: number;
    creditsAfter: number;
  }>(`/api/v1/upgrades/${playerUpgradeId}`, { method: 'DELETE' });
}
