import { NextResponse } from 'next/server';
import type { BoatState } from '@/lib/api';

/**
 * GET /api/v1/races/:raceId/my-boat
 *
 * Returns the current state of the player's boat in the race.
 * In production this will proxy to the Fastify game server.
 * For now: dev mock with static data.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ raceId: string }> },
): Promise<NextResponse<BoatState>> {
  const { raceId: _raceId } = await params;

  const state: BoatState = {
    boatClass: 'CLASS40',
    // 47°04'00.29"N / 3°24'21.08"W — VR benchmark position for projection comparison
    lat: 47.066747,
    lon: -3.405856,
    hdg: 216,
    bsp: 11.4,
    twd: 0,   // will be overwritten by GFS interpolation client-side
    tws: 0,
    twa: 0,
    vmg: 9.8,
    dtf: 1642,
    overlapFactor: 0.94,
    rank: 12,
    totalParticipants: 428,
    rankTrend: 2,
    wearGlobal: 82,
    wearDetail: { hull: 88, rig: 79, sails: 75, electronics: 86 },
    currentSail: 'JIB',
    sailAuto: false,
    transitionStartMs: 0,
    transitionEndMs: 0,
    maneuverKind: 0,
    maneuverStartMs: 0,
    maneuverEndMs: 0,
  };

  return NextResponse.json(state);
}
