import { NextRequest, NextResponse } from 'next/server';
import { City } from 'country-state-city';
import { FR_COMMUNES, normalizeCountry, type CityDto } from '../shared';

// Dynamique : dépend de country/subdivision/q en searchParams.
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

/**
 * GET /api/v1/places/cities?country=FR&subdivision=48&q=men&limit=20
 *
 * Recherche dans les communes de la subdivision donnée.
 * - country obligatoire (ISO 2)
 * - subdivision obligatoire (INSEE dpt pour FR, ISO 3166-2 state ailleurs)
 * - q facultatif (filtre par préfixe du nom, accent-insensible)
 * - limit facultatif (défaut 200, max 1000)
 *
 * Tri : France par population décroissante (permet d'avoir les grosses villes
 * en tête), autres pays par nom (la lib n'a pas la population partout).
 */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const country = normalizeCountry(req.nextUrl.searchParams.get('country') ?? '');
  const subdivision = req.nextUrl.searchParams.get('subdivision') ?? '';
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(req.nextUrl.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)),
  );

  if (!country || !subdivision) {
    return NextResponse.json(
      { error: 'Query params "country" and "subdivision" required' },
      { status: 400 },
    );
  }

  const qNorm = q.trim() ? normalize(q.trim()) : null;

  let cities: CityDto[];

  if (country === 'FR') {
    cities = FR_COMMUNES
      .filter((c) => c.departement === subdivision && c.type === 'commune-actuelle')
      .filter((c) => (qNorm ? normalize(c.nom).includes(qNorm) : true))
      .map((c): CityDto => ({
        name: c.nom,
        code: c.code,
        ...(typeof c.population === 'number' ? { population: c.population } : {}),
      }))
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
      .slice(0, limit);
  } else {
    cities = City.getCitiesOfState(country, subdivision)
      .filter((c) => (qNorm ? normalize(c.name).includes(qNorm) : true))
      .map((c): CityDto => ({
        name: c.name,
        // Pas de code INSEE hors FR, on dérive un slug pour clé unique.
        code: `${country}-${subdivision}-${c.name}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  return NextResponse.json({ cities });
}
