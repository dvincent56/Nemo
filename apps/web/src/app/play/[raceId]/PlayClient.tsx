'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { RaceSummary } from '@/lib/api';
import { connectRace, useGameStore } from '@/lib/store';
import { ANONYMOUS, decideRaceAccess, readClientSession, spectateBanner, type SessionContext } from '@/lib/access';
import HudBar from '@/components/play/HudBar';
import SailPanel from '@/components/play/SailPanel';
import Compass from '@/components/play/Compass';
import styles from './page.module.css';

const MapCanvas = dynamic(() => import('@/components/play/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className={styles.mapSkeleton}>
      <span className={styles.skeletonLabel}>Chargement de la carte nautique…</span>
    </div>
  ),
});

/**
 * Simulateur local / WS live. Si `canInteract` est false (spectateur), on se
 * connecte quand même en lecture seule pour voir les broadcasts.
 */
function useTicker(raceId: string): void {
  useEffect(() => {
    const live = process.env['NEXT_PUBLIC_WS_LIVE'] === '1';
    if (live) {
      const token = document.cookie
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('nemo_access_token='))
        ?.slice('nemo_access_token='.length);
      const conn = connectRace(raceId, token);
      return () => conn.close();
    }
    const setHud = useGameStore.getState().setHud;
    setHud({
      lat: 47.0, lon: -3.0, twd: 270, tws: 18, hdg: 90,
      twa: -180, twaColor: 'optimal', bsp: 7.55, vmg: 7.55,
      dtf: 2341.672, overlapFactor: 1.0, rank: 42,
    });
    useGameStore.getState().setSail({ currentSail: 'SPI' });
    useGameStore.getState().setConnection('open');
    const id = setInterval(() => {
      const hud = useGameStore.getState().hud;
      const twa = ((hud.hdg - hud.twd + 540) % 360) - 180;
      const color: 'optimal' | 'overlap' | 'neutral' | 'deadzone' =
        Math.abs(twa) < 28 ? 'deadzone' :
        (Math.abs(twa) >= 38 && Math.abs(twa) <= 54) || (Math.abs(twa) >= 140 && Math.abs(twa) <= 162) ? 'optimal' :
        Math.abs(twa) > 54 && Math.abs(twa) < 140 ? 'neutral' : 'overlap';
      setHud({ twa, twaColor: color });
    }, 1000);
    return () => clearInterval(id);
  }, [raceId]);
}

export default function PlayClient({ race }: { race: RaceSummary }): React.ReactElement {
  const [session, setSession] = useState<SessionContext>(ANONYMOUS);
  const [isRegistered, setIsRegistered] = useState(false);

  // Hydrate session et inscription côté client (le cookie n'est lisible qu'ici).
  useEffect(() => {
    setSession(readClientSession());
    // Phase 3 stub : on considère tout joueur authentifié comme inscrit à la
    // race démo pour que le flow soit testable. Phase 4 → appel API
    // /api/v1/races/:id/registration.
    if (typeof document !== 'undefined' && document.cookie.includes('nemo_access_token=')) {
      setIsRegistered(true);
    }
  }, []);

  const access = useMemo(
    () => decideRaceAccess({ race, session, isRegistered }),
    [race, session, isRegistered],
  );
  const banner = spectateBanner(access);
  const canInteract = access.kind === 'play';

  useTicker(race.id);

  if (access.kind === 'blocked') {
    return (
      <div className={styles.blockedShell}>
        <div className={styles.blockedCard}>
          <p className={styles.blockedEyebrow}>Accès refusé</p>
          <h1 className={styles.blockedTitle}>
            {access.reason === 'draft' && 'Cette course n\'est pas encore publiée.'}
            {access.reason === 'archived' && 'Cette course a été archivée.'}
            {access.reason === 'admin-only' && 'Page réservée aux administrateurs.'}
          </h1>
          <Link href="/races" className={styles.blockedBack}>← Retour aux courses</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <MapCanvas />
      <HudBar />

      {banner && access.kind === 'spectate' && (
        <div className={styles.spectateBanner} role="status">
          <span className={styles.spectateTag}>Spectateur</span>
          <span className={styles.spectateText}>{banner}</span>
          {access.reason === 'visitor' && (
            <Link href="/login" className={styles.spectateCta}>Se connecter →</Link>
          )}
          {access.reason === 'not-registered' && (
            <Link href="/races" className={styles.spectateCta}>S'inscrire →</Link>
          )}
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.left}>
          <div className={styles.infoCard}>
            <h1 className={styles.raceName}>{race.name}</h1>
            <p className={styles.raceMeta}>{race.boatClass} · {race.tierRequired}</p>
          </div>
          {canInteract && <SailPanel />}
        </div>

        {canInteract && (
          <div className={styles.actionRail}>
            <button className={styles.railBtn} type="button" aria-label="Ouvrir le routeur">⊕ Routeur</button>
            <button className={styles.railBtn} type="button" aria-label="Ouvrir la file d'ordres">≡ Ordres</button>
          </div>
        )}

        {canInteract && (
          <div className={styles.bottom}>
            <Compass />
          </div>
        )}
      </div>
    </div>
  );
}
