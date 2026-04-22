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

  // Mirrors game-engine/src/index.ts::createDemoRuntime — keep in sync until
  // the engine exposes a runtime snapshot endpoint that this route can proxy.
  // Dynamic fields (bsp, vmg, dtf, rank, wear, overlap) start at sensible
  // neutral values and get overwritten by the first WS tick payload.
  const state: BoatState = {
    boatClass: 'CRUISER_RACER',
    // 45°44'10.04"N / 5°50'23.31"W
    lat: 45.736122,
    lon: -5.839808,
    hdg: 216,
    bsp: 0,
    twd: 0,   // overwritten client-side by GFS interpolation until first tick
    tws: 0,
    twa: 0,
    vmg: 0,
    dtf: 0,
    overlapFactor: 1,
    rank: 0,
    totalParticipants: 0,
    rankTrend: 0,
    wearGlobal: 100,
    wearDetail: { hull: 100, rig: 100, sails: 100, electronics: 100 },
    speedPenaltyPct: 0,
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
