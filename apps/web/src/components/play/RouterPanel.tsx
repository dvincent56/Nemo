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
        <div className={styles.fieldLabel}>Point de départ</div>
        <div className={styles.card}>
          <span className={styles.cardIcon}>⚓</span>
          <div className={styles.cardMain}>
            <div className={styles.cardTitle}>Position bateau</div>
            <div className={styles.cardMeta}>
              {typeof lat === 'number' ? formatDMS(lat, true) : '—'} ·{' '}
              {typeof lon === 'number' ? formatDMS(lon, false) : '—'}
            </div>
          </div>
        </div>
      </section>

      {/* ARRIVAL */}
      <section className={styles.section}>
        <div className={styles.fieldLabel}>Point d&apos;arrivée</div>
        {phase === 'placing' ? (
          <div className={styles.placingHint}>
            <div className={styles.placingIcon}>📍</div>
            <div className={styles.placingMsg}>
              Cliquez (ou tapez) sur la carte<br />pour placer l&apos;arrivée
            </div>
            <button type="button" className={styles.cancelBtn} onClick={exitPlacing}>
              Annuler
            </button>
          </div>
        ) : dest ? (
          <div className={styles.card}>
            <span className={styles.cardIcon}>📍</span>
            <div className={styles.cardMain}>
              <div className={styles.cardTitle}>Arrivée</div>
              <div className={styles.cardMeta}>
                {formatDMS(dest.lat, true)} · {formatDMS(dest.lon, false)}
              </div>
            </div>
            <button type="button" className={styles.cardAside} onClick={enterPlacing}>
              Modifier
            </button>
          </div>
        ) : (
          <button type="button" className={styles.placeBtn} onClick={enterPlacing}>
            <span className={styles.placeBtnPlus}>+</span> Définir l&apos;arrivée
          </button>
        )}
      </section>

      <RouterControls disabled={phase === 'placing' || phase === 'calculating'} />

      {/* PRIMARY ACTIONS depending on phase */}
      {phase === 'calculating' && (
        <section className={styles.calculating}>
          <div className={styles.spinner} />
          <div className={styles.calcLabel}>Calcul en cours…</div>
          <div className={styles.calcSub}>Fermer le panneau pour annuler</div>
        </section>
      )}

      {phase === 'results' && route && <ResultsBlock plan={route} onApply={onApply} />}

      {phase === 'idle' && (
        <RouteButton canRoute={canRoute} isGridLoaded={isGridLoaded} hasDest={dest !== null} />
      )}

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

function RouteButton({
  canRoute,
  isGridLoaded,
  hasDest,
}: {
  canRoute: boolean;
  isGridLoaded: boolean;
  hasDest: boolean;
}): React.ReactElement {
  const hint = !hasDest
    ? 'Définir l’arrivée pour calculer'
    : !isGridLoaded
    ? 'Météo en chargement…'
    : null;
  return (
    <button
      type="button"
      className={`${styles.routeBtn} ${!canRoute ? styles.routeBtnDisabled : ''}`}
      disabled={!canRoute}
      onClick={() => window.dispatchEvent(new CustomEvent('nemo:router:route'))}
    >
      Router
      {hint && <span className={styles.routeBtnSub}>{hint}</span>}
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
      <div className={styles.resultsHead}>✓ Route calculée</div>
      <div className={styles.resultsGrid}>
        <div>
          <span className={styles.metricLabel}>Distance</span>
          <span className={styles.metricValue}>
            {totalNm}<span className={styles.metricUnit}>nm</span>
          </span>
        </div>
        <div>
          <span className={styles.metricLabel}>ETA</span>
          <span className={styles.metricValue}>
            {durationSec !== null ? (
              <>
                +{etaH}h<span className={styles.metricUnit}>{etaM}m</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div>
          <span className={styles.metricLabel}>Calcul</span>
          <span className={styles.metricValue}>
            {(plan.computeTimeMs / 1000).toFixed(1)}<span className={styles.metricUnit}>s</span>
          </span>
        </div>
        <div>
          <span className={styles.metricLabel}>Manœuvres</span>
          <span className={styles.metricValue}>{plan.capSchedule.length}</span>
        </div>
      </div>
      {!plan.reachedGoal && (
        <div className={styles.warning}>⚠ Route incomplète : météo limitée à J+7</div>
      )}
      <button type="button" className={styles.applyPrimary} onClick={() => onApply('WAYPOINTS')}>
        → Points de contrôle
      </button>
      <button type="button" className={styles.applySecondary} onClick={() => onApply('CAP')}>
        → Programmation de cap
      </button>
    </section>
  );
}
