'use client';
import { useEffect } from 'react';
import { useGameStore } from '@/lib/store';
import { fetchBoatTrack } from '@/lib/api/track';

/**
 * Au mount du PlayClient, charge l'historique de tracé via l'API
 * game-engine et abonne le store aux events `trackPointAdded` (déjà
 * routés par applyMessages).
 *
 * Phase 1 : la clé serveur est `boatId`. Phase 4 : `participantId`.
 */
export function useTrackHydration(raceId: string, boatId: string | null): void {
  const setTrack = useGameStore((s) => s.setTrack);
  const setLoading = useGameStore((s) => s.setTrackLoading);
  const setError = useGameStore((s) => s.setTrackError);
  const clearTrack = useGameStore((s) => s.clearTrack);
  const setSelfParticipantId = useGameStore((s) => s.setSelfParticipantId);

  useEffect(() => {
    if (!boatId) return;
    let cancelled = false;
    setSelfParticipantId(boatId);
    setLoading(true);
    fetchBoatTrack(raceId, boatId)
      .then((res) => {
        if (cancelled) return;
        setTrack(res.points);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'unknown error');
      });

    return () => {
      cancelled = true;
      clearTrack();
    };
  }, [raceId, boatId, setTrack, setLoading, setError, clearTrack, setSelfParticipantId]);
}
