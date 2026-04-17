'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { RaceSummary } from '@/lib/api';
import { connectRace, useGameStore } from '@/lib/store';
import {
  ANONYMOUS, decideRaceAccess, readClientSession, spectateBanner,
  type SessionContext,
} from '@/lib/access';
import HudBar from '@/components/play/HudBar';
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
    const store = useGameStore.getState();
    store.setHud({
      lat: 47.0, lon: -3.0, twd: 270, tws: 18, hdg: 216,
      twa: 128, twaColor: 'optimal', bsp: 11.4, vmg: 9.8,
      dtf: 1642, overlapFactor: 0.94, rank: 12, totalParticipants: 428,
      rankTrend: 2, wearGlobal: 82,
      wearDetail: { hull: 88, rig: 79, sails: 75, electronics: 86 },
    });
    store.setSail({ currentSail: 'GEN' });
    store.setConnection('open');
    return undefined;
  }, [raceId]);
}

export default function PlayClient({ race }: { race: RaceSummary }): React.ReactElement {
  const [session, setSession] = useState<SessionContext>(ANONYMOUS);
  const [isRegistered, setIsRegistered] = useState(false);
  const activePanel = useGameStore((s) => s.panel.activePanel);
  const rank = useGameStore((s) => s.hud.rank);

  useEffect(() => {
    setSession(readClientSession());
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

  const handlePanelToggle = (panel: 'ranking' | 'sails' | 'programming') => {
    if (activePanel === panel) {
      useGameStore.getState().closePanel();
    } else {
      useGameStore.getState().openPanel(panel);
    }
  };

  return (
    <div className={styles.app}>
      {/* Row 1 — HUD */}
      <div className={styles.hudRow}>
        {canInteract && <HudBar />}
      </div>

      {/* Row 2 — Map + floating elements */}
      <div className={styles.mapArea}>
        <MapCanvas />

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

        {/* Ranking tab (left edge) */}
        <button
          className={styles.rankingTab}
          onClick={() => handlePanelToggle('ranking')}
          title="Classement (C)"
          type="button"
        >
          <span className={styles.rankingTabArrow}>
            {activePanel === 'ranking' ? '◀' : '▶'}
          </span>
          <span className={styles.rankingTabLabel}>CLASSEMENT</span>
          <span className={styles.rankingTabRank}>{rank}</span>
        </button>

        {/* Right stack — action buttons + compass */}
        {canInteract && (
          <div className={styles.rightStack}>
            <div className={styles.actionButtons}>
              <button
                className={`${styles.actionBtn} ${activePanel === 'sails' ? styles.actionBtnActive : ''}`}
                onClick={() => handlePanelToggle('sails')}
                title="Voiles (V)"
                type="button"
              >
                <span className={styles.actionBtnIcon}>⛵</span>
                <span>Voiles</span>
              </button>
              <button
                className={`${styles.actionBtn} ${activePanel === 'programming' ? styles.actionBtnActive : ''}`}
                onClick={() => handlePanelToggle('programming')}
                title="Programmation (P)"
                type="button"
              >
                <span className={styles.actionBtnIcon}>≡</span>
                <span>Prog.</span>
              </button>
              <button
                className={styles.actionBtn}
                onClick={() => useGameStore.getState().setFollowBoat(true)}
                title="Recentrer (Espace)"
                type="button"
              >
                <span className={styles.actionBtnIcon}>⊕</span>
                <span>Centrer</span>
              </button>
              <div className={styles.zoomGroup}>
                <button className={styles.zoomBtn} title="Zoom +" type="button">+</button>
                <button className={styles.zoomBtn} title="Zoom −" type="button">−</button>
              </div>
            </div>
            <Compass />
          </div>
        )}
      </div>

      {/* Row 3 — Timeline placeholder */}
      <div className={styles.timelineRow}>
        <span className={styles.timelinePlaceholder}>Timeline météo — à venir</span>
      </div>
    </div>
  );
}
