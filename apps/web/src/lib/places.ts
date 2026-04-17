/**
 * Client fetcher pour la cascade Pays → Subdivision → Ville.
 *
 * Les données brutes (Etalab France ~12 MB + country-state-city ~3 MB) vivent
 * côté serveur dans les route handlers `/api/v1/places/*`. Côté client on
 * consomme uniquement ces endpoints JSON, ce qui garde le bundle léger.
 *
 * Phase 4 (Cognito + backend Fastify) : ces fonctions seront pointées vers
 * les vrais endpoints `/api/v1/places/*` du serveur de jeu, mêmes payloads,
 * aucune modif dans les composants.
 */

export interface Country {
  code: string;
  name: string;
  flag: string;
  hasSubdivisions: boolean;
}

export interface Subdivision {
  code: string;
  name: string;
}

export interface City {
  name: string;
  code: string;
  population?: number;
}

export async function fetchCountries(): Promise<Country[]> {
  const res = await fetch('/api/v1/places/countries');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { countries: Country[] };
  return data.countries;
}

export async function fetchSubdivisions(country: string): Promise<Subdivision[]> {
  const res = await fetch(`/api/v1/places/subdivisions?country=${encodeURIComponent(country)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { subdivisions: Subdivision[] };
  return data.subdivisions;
}

export async function fetchCities(
  country: string,
  subdivision: string,
  query?: string,
): Promise<City[]> {
  const qs = new URLSearchParams({ country, subdivision });
  if (query && query.trim()) qs.set('q', query.trim());
  const res = await fetch(`/api/v1/places/cities?${qs.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { cities: City[] };
  return data.cities;
}
