'use client';
import { useGameStore } from '@/lib/store';
import RouterControls from './RouterControls';
import { formatDMS } from './formatDMS';
import styles from './RouterPanel.module.css';

export default function RouterPanel({
  onApply,
}: {
  onApply: (mode: 'WAYPOINTS' | 'CAP') => void;
}): React.ReactElement {
  const phase = useGameStore((s) => s.router.phase);
  const dest = useGameStore((s) => s.router.destination);
  const route = useGameStore((s) => s.router.computedRoute);
  const error = useGameStore((s) => s.router.error);
  const lat = useGameStore((s) => s.hud.lat);
  const lon = useGameStore((s) => s.hud.lon);
  const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
  const isGridLoaded = decodedGrid !== null;

  const enterPlacing = useGameStore((s) => s.enterPlacingMode);
  const exitPlacing = useGameStore((s) => s.exitPlacingMode);

  const canRoute = dest !== null && phase === 'idle' && isGridLoaded;

  return (
    <div className={`${styles.panel} ${phase === 'placing' ? styles.panelPlacing : ''}`}>
      {/* DEPART (auto = boat position) */}
      <section className={styles.section}>
        <div className={styles.label}>Point de départ</div>
        <div className={styles.coords}>
          ⚓ Position bateau<br />
          <span className={styles.subCoords}>
            {typeof lat === 'number' ? formatDMS(lat, true) : '—'} ·{' '}
            {typeof lon === 'number' ? formatDMS(lon, false) : '—'}
          </span>
        </div>
      </section>

      {/* ARRIVAL */}
      <section className={styles.section}>
        <div className={styles.label}>Point d&apos;arrivée</div>
        {phase === 'placing' ? (
          <div className={styles.placingHint}>
            <div className={styles.placingIcon}>📍</div>
            <div>Cliquez (ou tapez) sur la carte<br />pour placer l&apos;arrivée</div>
            <button type="button" className={styles.cancelBtn} onClick={exitPlacing}>
              Annuler
            </button>
          </div>
        ) : dest ? (
          <button type="button" className={styles.destBtn} onClick={enterPlacing}>
            📍 {formatDMS(dest.lat, true)} · {formatDMS(dest.lon, false)}
            <span className={styles.changeHint}>Changer</span>
          </button>
        ) : (
          <button type="button" className={styles.placeBtn} onClick={enterPlacing}>
            + Définir le point d&apos;arrivée
          </button>
        )}
      </section>

      <RouterControls disabled={phase === 'placing' || phase === 'calculating'} />

      {/* PRIMARY ACTIONS depending on phase */}
      {phase === 'calculating' && (
        <section className={styles.calculating}>
          <div className={styles.spinner} />
          <div className={styles.calcLabel}>CALCUL EN COURS…</div>
          <div className={styles.calcSub}>Fermer le panneau pour annuler</div>
        </section>
      )}

      {phase === 'results' && route && <ResultsBlock plan={route} onApply={onApply} />}

      {phase === 'idle' && (
        <RouteButton canRoute={canRoute} isGridLoaded={isGridLoaded} />
      )}

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

function RouteButton({ canRoute, isGridLoaded }: { canRoute: boolean; isGridLoaded: boolean }): React.ReactElement {
  return (
    <button
      type="button"
      className={`${styles.routeBtn} ${!canRoute ? styles.routeBtnDisabled : ''}`}
      disabled={!canRoute}
      onClick={() => window.dispatchEvent(new CustomEvent('nemo:router:route'))}
    >
      ROUTER
      {!isGridLoaded && <div className={styles.routeBtnSub}>Météo en chargement…</div>}
    </button>
  );
}

function ResultsBlock({
  plan,
  onApply,
}: {
  plan: import('@nemo/routing').RoutePlan;
  onApply: (mode: 'WAYPOINTS' | 'CAP') => void;
}): React.ReactElement {
  const totalNm = plan.totalDistanceNm.toFixed(0);
  // `plan.eta` is an absolute timestamp in ms (arrivalPoint.timeMs).
  // The duration is eta − polyline[0].timeMs (start), in ms. If the route
  // didn't reach the goal `eta` is +Infinity → show "—".
  const startMs = plan.polyline[0]?.timeMs ?? 0;
  const durationSec = Number.isFinite(plan.eta) ? Math.max(0, (plan.eta - startMs) / 1000) : null;
  const etaH = durationSec !== null ? Math.floor(durationSec / 3600) : 0;
  const etaM = durationSec !== null ? Math.floor((durationSec % 3600) / 60) : 0;
  return (
    <section className={styles.results}>
      <div className={styles.resultsHead}>✓ ROUTE CALCULÉE</div>
      <div className={styles.resultsGrid}>
        <div><span className={styles.metricLabel}>Distance</span><br /><strong>{totalNm} nm</strong></div>
        <div>
          <span className={styles.metricLabel}>ETA</span><br />
          <strong>{durationSec !== null ? `+${etaH}h ${etaM}m` : '—'}</strong>
        </div>
        <div><span className={styles.metricLabel}>Calcul</span><br /><strong>{(plan.computeTimeMs / 1000).toFixed(1)}s</strong></div>
        <div><span className={styles.metricLabel}>Manœuvres</span><br /><strong>{plan.capSchedule.length}</strong></div>
      </div>
      {!plan.reachedGoal && (
        <div className={styles.warning}>⚠ Route incomplète : météo limitée à J+7</div>
      )}
      <button type="button" className={styles.applyPrimary} onClick={() => onApply('WAYPOINTS')}>
        → WAYPOINTS (auto-voile)
      </button>
      <button type="button" className={styles.applySecondary} onClick={() => onApply('CAP')}>
        → CAP SCHEDULE (auto-voile)
      </button>
    </section>
  );
}
