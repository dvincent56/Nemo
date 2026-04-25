import type { TrackPointAddedMsg } from './payload.js';

export function buildTrackPointAddedMsg(input: {
  participantId: string;
  tsMs: number;
  lat: number;
  lon: number;
  rank: number;
}): TrackPointAddedMsg {
  return {
    kind: 'trackPointAdded',
    participantId: input.participantId,
    ts: input.tsMs,
    lat: input.lat,
    lon: input.lon,
    rank: input.rank,
  };
}
