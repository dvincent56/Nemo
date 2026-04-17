import { NextRequest, NextResponse } from 'next/server';
import { State } from 'country-state-city';
import { FR_DEPARTEMENTS, normalizeCountry, type SubdivisionDto } from '../shared';

// Les searchParams (country) rendent cette route dynamique. `force-static`
// servirait un seul résultat figé au build (vide). On la laisse dynamique.
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/places/subdivisions?country=FR
 *
 * Pour la France → départements INSEE (96 métropole + DOM-TOM) via Etalab,
 * triés par code.
 * Pour les autres pays → subdivisions ISO 3166-2 via country-state-city.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const country = normalizeCountry(req.nextUrl.searchParams.get('country') ?? '');
  if (!country) {
    return NextResponse.json(
      { error: 'Query param "country" required (ISO 3166-1 alpha-2)' },
      { status: 400 },
    );
  }

  let subdivisions: SubdivisionDto[];

  if (country === 'FR') {
    // Données officielles INSEE : 96 dpts métro + 5 DOM + collectivités.
    subdivisions = FR_DEPARTEMENTS.map((d): SubdivisionDto => ({
      code: d.code,
      name: `${d.code} · ${d.nom}`,
    })).sort((a, b) => a.code.localeCompare(b.code));
  } else {
    subdivisions = State.getStatesOfCountry(country).map((s): SubdivisionDto => ({
      code: s.isoCode,
      name: s.name,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  return NextResponse.json({ subdivisions });
}
