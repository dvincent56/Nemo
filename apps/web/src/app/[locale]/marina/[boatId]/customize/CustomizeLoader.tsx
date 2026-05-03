'use client';

import { useEffect, useState } from 'react';
import { fetchBoatDetail } from '@/lib/marina-api';
import type { BoatDetail } from '../../data';
import CustomizeView from './CustomizeView';
import styles from './page.module.css';

interface CustomizeLoaderProps {
  boatId: string;
}

/**
 * Fetches the boat from the marina API and hands it to CustomizeView.
 * Kept as a thin adapter: CustomizeView only needs id/name/class/hullColor/
 * hullNumber/deckColor, which we synthesize from the API response.
 */
export default function CustomizeLoader({ boatId }: CustomizeLoaderProps): React.ReactElement {
  const [boat, setBoat] = useState<BoatDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBoatDetail(boatId)
      .then((detail) => {
        setBoat({
          id: detail.boat.id,
          name: detail.boat.name,
          boatClass: detail.boat.boatClass,
          hullColor: detail.boat.hullColor ?? '#1a2840',
          deckColor: detail.boat.deckColor ?? '#e4ddd0',
          hullNumber: String(detail.boat.id.slice(0, 3)).toUpperCase(),
        });
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur inconnue'));
  }, [boatId]);

  if (error) {
    return (
      <div className={styles.loadingState ?? ''} style={{ padding: '2rem', textAlign: 'center' }}>
        Impossible de charger ce bateau : {error}.
      </div>
    );
  }

  if (!boat) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        Chargement…
      </div>
    );
  }

  return <CustomizeView boat={boat} />;
}
