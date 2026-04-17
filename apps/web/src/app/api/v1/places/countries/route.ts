import { NextResponse } from 'next/server';
import { Country } from 'country-state-city';
import type { CountryDto } from '../shared';

export const dynamic = 'force-static';
export const revalidate = 86400; // 24 h : la liste des pays bouge rarement

/**
 * GET /api/v1/places/countries
 * Liste des 250 pays ISO 3166-1. Triés par nom.
 */
export async function GET(): Promise<NextResponse> {
  const countries = Country.getAllCountries().map((c): CountryDto => ({
    code: c.isoCode,
    name: c.name,
    flag: c.flag,
    // Heuristique : si la lib retourne des states, on propose une cascade
    // subdivisions. Sinon on saute directement à "Ville".
    hasSubdivisions: true,
  }));

  countries.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ countries });
}
