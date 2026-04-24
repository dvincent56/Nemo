const EARTH_RADIUS_NM = 3440.065;
const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;
const NM_TO_KM = 1.852;

export type LonLat = readonly [number, number];
export type DistanceUnit = 'nm' | 'km';

function haversine(a: LonLat, b: LonLat, radius: number): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const p1 = lat1 * DEG_TO_RAD;
  const p2 = lat2 * DEG_TO_RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export function haversineNM(a: LonLat, b: LonLat): number {
  return haversine(a, b, EARTH_RADIUS_NM);
}

export function haversineKm(a: LonLat, b: LonLat): number {
  return haversine(a, b, EARTH_RADIUS_KM);
}

/** Position-object variants — web-side code historically uses {lat, lon} objects. */
export function haversinePosNM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversine([a.lon, a.lat], [b.lon, b.lat], EARTH_RADIUS_NM);
}

export function haversinePosKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversine([a.lon, a.lat], [b.lon, b.lat], EARTH_RADIUS_KM);
}

/** 4-scalar variant for hot paths (buffer-indexed loops) that don't want to allocate. */
export function haversineKmScalar(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversine([lon1, lat1], [lon2, lat2], EARTH_RADIUS_KM);
}

export interface Course {
  start: LonLat;
  finish: LonLat;
  waypoints: readonly LonLat[];
}

export function courseLengthNM(course: Course): number {
  const legs: LonLat[] = [course.start, ...course.waypoints, course.finish];
  let total = 0;
  for (let i = 1; i < legs.length; i++) {
    total += haversineNM(legs[i - 1]!, legs[i]!);
  }
  return total;
}

export function formatDistance(nm: number, unit: DistanceUnit = 'nm'): { value: string; unit: DistanceUnit } {
  const raw = unit === 'nm' ? nm : nm * NM_TO_KM;
  const rounded = raw >= 1000 ? Math.round(raw / 10) * 10 : Math.round(raw);
  return { value: rounded.toLocaleString('fr-FR'), unit };
}
