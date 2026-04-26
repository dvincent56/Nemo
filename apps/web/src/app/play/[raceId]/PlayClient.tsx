'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { RaceSummary } from '@/lib/api';
import { fetchMyBoat, fetchRaceZones, API_BASE } from '@/lib/api';
import { connectRace, sendOrder, useGameStore } from '@/lib/store';
import {
  ANONYMOUS, decideRaceAccess, readClientSession, spectateBanner,
  type SessionContext,
} from '@/lib/access';
import { useHotkeys } from '@/lib/useHotkeys';
import { useWeatherPrefetch } from '@/hooks/useWeatherPrefetch';
import { useTacticalTile } from '@/hooks/useTacticalTile';
import Tooltip from '@/components/ui/Tooltip';
import HudBar from '@/components/play/HudBar';
import Compass from '@/components/play/Compass';
import CoordsDisplay from '@/components/play/CoordsDisplay';
import SlidePanel from '@/components/play/SlidePanel';
import SailPanel from '@/components/play/SailPanel';
import ProgPanel from '@/components/play/ProgPanel';
import RankingPanel from '@/components/play/RankingPanel';
import RouterPanel from '@/components/play/RouterPanel';
import ConfirmReplaceProgModal from '@/components/play/ConfirmReplaceProgModal';
import WindOverlay from '@/components/play/WindOverlay';
import SwellOverlay from '@/components/play/SwellOverlay';
import LayersWidget from '@/components/play/LayersWidget';
import CursorTooltip from '@/components/play/CursorTooltip';
import WindLegend from '@/components/play/WindLegend';
import WeatherTimeline from '@/components/play/WeatherTimeline';
import { sampleDecodedWindAtTime } from '@/lib/weather/gridFromBinary';
import { loadPolar, getCachedPolar } from '@/lib/polar';
import { GameBalance } from '@nemo/game-balance/browser';
import { computeRoute } from '@/lib/routing/client';
import { capScheduleToOrders, waypointsToOrders } from '@/lib/routing/applyRoute';
import { packWindData } from '@/lib/projection/fetchWindGrid';
import { resolveBoatLoadout } from '@nemo/game-engine-core/browser';
import type { RouteInput } from '@nemo/routing';
import { Trophy, Sailboat, Route, LocateFixed, MapPinned } from 'lucide-react';
import ZoomCompact from '@/components/play/ZoomCompact';
import { RouteLayer } from '@/components/map/routing/RouteLayer';
import { IsochroneLayer } from '@/components/map/routing/IsochroneLayer';
import RouterDestinationMarker from '@/components/map/routing/RouterDestinationMarker';
import { mapInstance } from '@/components/play/MapCanvas';
import styles from './page.module.css';

// Main-thread GameBalance bootstrap. Workers load their own instance via
// postMessage; this client-side load is needed for any UI component that
// reads GameBalance at render (e.g. Compass's maneuver hint).
let gbBootstrap: Promise<void> | null = null;
let gbJsonCache: unknown = null;
function bootstrapGameBalance(): Promise<void> {
  if (GameBalance.isLoaded && gbJsonCache !== null) return Promise.resolve();
  if (gbBootstrap) return gbBootstrap;
  gbBootstrap = fetch('/data/game-balance.json')
    .then((r) => r.json())
    .then((json) => { gbJsonCache = json; GameBalance.load(json); });
  return gbBootstrap;
}

// Inline great-circle bearing — mirror of @nemo/game-engine-core/src/geo
// `bearingDeg`. Kept local to avoid widening engine-core's public exports for a
// single optimistic-UI use site (same pattern as projection.worker.ts).
const DEG_TO_RAD_PC = Math.PI / 180;
const RAD_TO_DEG_PC = 180 / Math.PI;
function bearingDeg(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const f1 = from.lat * DEG_TO_RAD_PC;
  const f2 = to.lat * DEG_TO_RAD_PC;
  const dLon = (to.lon - from.lon) * DEG_TO_RAD_PC;
  const y = Math.sin(dLon) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dLon);
  const theta = Math.atan2(y, x);
  return ((theta * RAD_TO_DEG_PC) + 360) % 360;
}

const MapCanvas = dynamic(() => import('@/components/play/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className={styles.mapSkeleton}>
      <span className={styles.skeletonLabel}>Chargement de la carte nautique…</span>
    </div>
  ),
});

/**
 * Fetch initial boat state from API, seed the store, then open WS for deltas.
 */
function useBoatInit(raceId: string): void {
  useEffect(() => {
    const store = useGameStore.getState();
    store.goLive();
    let cancelled = false;

    // Dev-only: reset the demo runtime to its configured START_POS before
    // reading initial state, so opening Play always lands on the intended
    // position rather than wherever the continuously-ticking engine drifted
    // to. No-op in prod (endpoint returns 404 when NEMO_DEV_ROUTES=0).
    const reset = fetch(new URL(`/api/v1/dev/reset-demo`, API_BASE), { method: 'POST' })
      .catch(() => null);

    reset.then(() => fetchMyBoat(raceId)).then(async (boat) => {
      if (cancelled || !boat) return;

      // Load polar before seeding the store so that when boatClass hits the
      // store and triggers SailPanel/Compass renders, getCachedPolar() is
      // already populated — no flash of '—' values.
      await loadPolar(boat.boatClass).catch(() => {});

      if (cancelled) return;
      store.setHud({
        boatClass: boat.boatClass,
        lat: boat.lat, lon: boat.lon, hdg: boat.hdg, bsp: boat.bsp,
        twd: boat.twd, tws: boat.tws, twa: boat.twa,
        vmg: boat.vmg,
        dtf: boat.dtf, overlapFactor: boat.overlapFactor,
        bspBaseMultiplier: boat.bspBaseMultiplier,
        rank: boat.rank, totalParticipants: boat.totalParticipants,
        rankTrend: boat.rankTrend, wearGlobal: boat.wearGlobal,
        wearDetail: boat.wearDetail,
        speedPenaltyPct: boat.speedPenaltyPct,
        ...(boat.effects ? { effects: boat.effects } : {}),
      });
      store.setSail({
        currentSail: boat.currentSail,
        sailAuto: boat.sailAuto,
        transitionStartMs: boat.transitionStartMs,
        transitionEndMs: boat.transitionEndMs,
        maneuverKind: boat.maneuverKind,
        maneuverStartMs: boat.maneuverStartMs,
        maneuverEndMs: boat.maneuverEndMs,
      });
      store.setConnection('open');

      // Load race exclusion zones (DST/ZEA/ZPC/ZES)
      fetchRaceZones(raceId)
        .then((zones) => { if (!cancelled) store.setZones(zones); })
        .catch(() => {});


      // Once initial state is loaded, open WS for live deltas
      const live = process.env['NEXT_PUBLIC_WS_LIVE'] === '1';
      if (live) {
        const token = document.cookie
          .split(';')
          .map((c) => c.trim())
          .find((c) => c.startsWith('nemo_access_token='))
          ?.slice('nemo_access_token='.length);
        connectRace(raceId, token);
      }
    });

    return () => { cancelled = true; };
  }, [raceId]);
}

export default function PlayClient({ race }: { race: RaceSummary }): React.ReactElement {
  const [session, setSession] = useState<SessionContext>(ANONYMOUS);
  const [isRegistered, setIsRegistered] = useState(false);
  const [gbReady, setGbReady] = useState(() => GameBalance.isLoaded);
  const activePanel = useGameStore((s) => s.panel.activePanel);
  const rank = useGameStore((s) => s.hud.rank);
  const routerPhase = useGameStore((s) => s.router.phase);
  const routerDest = useGameStore((s) => s.router.destination);
  const routerRoute = useGameStore((s) => s.router.computedRoute);
  const routerPanelOpen = activePanel === 'router';

  useEffect(() => {
    setSession(readClientSession());
    if (typeof document !== 'undefined' && document.cookie.includes('nemo_access_token=')) {
      setIsRegistered(true);
    }
    if (!gbReady) {
      bootstrapGameBalance().then(() => setGbReady(true)).catch(() => {});
    }
  }, [gbReady]);

  const access = useMemo(
    () => decideRaceAccess({ race, session, isRegistered }),
    [race, session, isRegistered],
  );
  const banner = spectateBanner(access);
  const canInteract = access.kind === 'play';

  useBoatInit(race.id);
  useHotkeys(canInteract);
  // Prefetch multi-hour GRIB so the projection sees wind evolution over time.
  useWeatherPrefetch({ phase2: true });
  // Lazily fetch a high-res 0.25° tactical tile around the boat position.
  useTacticalTile();

  // Seed HUD wind from the multi-hour decoded GFS grid with temporal interp
  // at the current wall-clock — same formula the engine runs at each tick,
  // so the values match within bilinear rounding. Runs only before the first
  // WS tick lands; after that, server payload takes over.
  // Prefer the 0.25° tactical tile when loaded — the engine reads weather
  // from the same 0.25° NOAA grid, so the global 1° decimation would seed
  // the HUD with a value off by ~1 kt. Re-fires when the tile arrives.
  const decodedGrid = useGameStore((s) => s.weather.decodedGrid);
  const tacticalTile = useGameStore((s) => s.weather.tacticalTile);
  const boatLat = useGameStore((s) => s.hud.lat);
  const boatLon = useGameStore((s) => s.hud.lon);
  const boatHdg = useGameStore((s) => s.hud.hdg);
  const lastTickUnix = useGameStore((s) => s.lastTickUnix);
  useEffect(() => {
    if (!boatLat && !boatLon) return;
    if (lastTickUnix !== null) return;
    const inTile = tacticalTile
      && boatLat >= tacticalTile.bounds.latMin && boatLat <= tacticalTile.bounds.latMax
      && boatLon >= tacticalTile.bounds.lonMin && boatLon <= tacticalTile.bounds.lonMax;
    const source = inTile && tacticalTile ? tacticalTile.decoded : decodedGrid;
    if (!source) return;
    const wind = sampleDecodedWindAtTime(source, boatLat, boatLon);
    if (wind.tws === 0 && wind.twd === 0) return; // out of grid
    const tws = Math.round(wind.tws * 10) / 10;
    const twd = Math.round(wind.twd);
    const twa = Math.round(((boatHdg - twd + 540) % 360) - 180);
    useGameStore.getState().setHud({ twd, tws, twa });
  }, [decodedGrid, tacticalTile, boatLat, boatLon, boatHdg, lastTickUnix]);

  // Router invocation — RouterPanel dispatches 'nemo:router:route' on click;
  // we kick off computeRoute() with the latest store state and post the
  // result back into the slice with a fresh genId so closeRouter / a newer
  // click invalidates older in-flight calculations.
  const prevDecodedGrid = useGameStore((s) => s.weather.prevDecodedGrid);
  const boatClass = useGameStore((s) => s.hud.boatClass);
  useEffect(() => {
    const onRoute = async (): Promise<void> => {
      const state = useGameStore.getState();
      const dest = state.router.destination;
      const cls = state.hud.boatClass;
      const polar = cls ? getCachedPolar(cls) : null;
      if (
        !dest || !decodedGrid || !polar || !cls
        || typeof state.hud.lat !== 'number'
        || typeof state.hud.lon !== 'number'
        || gbJsonCache === null
      ) return;

      const genId = state.startRouteCalculation();

      try {
        const current = packWindData(decodedGrid);
        const prev = prevDecodedGrid ? packWindData(prevDecodedGrid) : null;
        // Loadout: the play screen has no installed-upgrades endpoint yet
        // (fetchMyBoat returns aggregated `effects` but not the items[]
        // list). Mirror what the game-engine demo does in
        // `apps/game-engine/src/index.ts`: resolve a SERIE-only loadout for
        // the current boat class. When the upgrades-installed API lands,
        // pass the real installed list here. GameBalance is already loaded
        // at this point (gbJsonCache !== null guard above).
        const loadout = resolveBoatLoadout('play-boat', [], cls);
        // Condition: mirror the projection's assembly — wearDetail is the
        // live per-component wear (hull/rig/sails/electronics), which is
        // exactly the ConditionState shape the engine reads in computeBsp /
        // conditionSpeedPenalty.
        const condition = {
          hull: state.hud.wearDetail.hull,
          rig: state.hud.wearDetail.rig,
          sails: state.hud.wearDetail.sails,
          electronics: state.hud.wearDetail.electronics,
        };
        const input: RouteInput = {
          from: { lat: state.hud.lat, lon: state.hud.lon },
          to: { lat: dest.lat, lon: dest.lon },
          startTimeMs: Date.now(),
          boatClass: cls,
          polar,
          loadout,
          condition,
          windGrid: current.windGrid,
          windData: new Float32Array(current.windData),
          ...(prev
            ? { prevWindGrid: prev.windGrid, prevWindData: new Float32Array(prev.windData) }
            : {}),
          // Coastline: the routing worker lazy-loads + indexes the coastline
          // GeoJSON once at module scope on the first compute, then attaches
          // it as `coastlineIndex` whenever `coastDetection` is true. We just
          // forward the toggle — no client-side fetch needed.
          coastDetection: state.router.coastDetection,
          coneHalfDeg: state.router.coneHalfDeg,
          preset: state.router.preset,
        };
        const plan = await computeRoute(input, gbJsonCache);
        useGameStore.getState().setRouteResult(plan, genId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur de calcul';
        useGameStore.getState().setRouteError(msg, genId);
      }
    };
    window.addEventListener('nemo:router:route', onRoute);
    return () => window.removeEventListener('nemo:router:route', onRoute);
  }, [decodedGrid, prevDecodedGrid, boatClass]);

  // Router apply flow — convert computed route to orders, replace local
  // queue, dispatch each over WS, close panel. If the queue already has
  // future orders, prompt to confirm the replace first.
  const [pendingApply, setPendingApply] = useState<'WAYPOINTS' | 'CAP' | null>(null);
  const orderQueue = useGameStore((s) => s.prog.orderQueue);
  const futureOrdersCount = orderQueue.length;

  const performApply = (mode: 'WAYPOINTS' | 'CAP'): void => {
    const state = useGameStore.getState();
    const plan = state.router.computedRoute;
    if (!plan) return;
    const baseTs = Date.now();
    // Skip the leading MODE(auto:true) order when the boat is already in
    // sail-auto — otherwise the queue gets a redundant first entry every time
    // the player applies a route.
    const sailAutoAlready = state.sail.sailAuto === true;
    const orders = mode === 'WAYPOINTS'
      ? waypointsToOrders(plan, baseTs, sailAutoAlready)
      : capScheduleToOrders(plan, baseTs, sailAutoAlready);
    // Replace pending local orders with the freshly-applied route. Each order
    // is also dispatched to the server *now* via sendOrder; orders carry a
    // `committed: true` flag (set by applyRoute helpers) so ProgPanel's
    // "Valider la file" handler skips them and we avoid double-send. Keeping
    // them in the queue gives the user immediate visibility into what was
    // applied. The ConfirmReplaceProgModal already warns before clobbering a
    // non-empty queue.
    for (const o of orders) sendOrder({ type: o.type, value: o.value, trigger: o.trigger });
    state.replaceOrderQueue(orders);

    // Optimistic UI: any order that fires *now* (IMMEDIATE or AT_TIME with a
    // past timestamp — capScheduleToOrders emits the first CAP/TWA at
    // `Date.now()` which has already drifted into the past by the time we get
    // here) won't visibly affect the HUD until the next server tick lands. We
    // mirror the manual-control pattern (SailPanel toggleAuto, Compass apply)
    // by patching the store immediately so heading / sailAuto / sail flip
    // without waiting. mergeField in the tick handler preserves these
    // optimistic values until the server confirms convergence.
    const nowMs = Date.now();
    const firesImmediately = (t: typeof orders[number]['trigger']): boolean =>
      t.type === 'IMMEDIATE' || (t.type === 'AT_TIME' && t.time * 1000 <= nowMs);
    for (const o of orders) {
      if (!firesImmediately(o.trigger)) continue;
      switch (o.type) {
        case 'MODE': {
          const auto = (o.value as { auto?: unknown }).auto;
          if (typeof auto === 'boolean') {
            state.setSailOptimistic('sailAuto', auto);
          }
          break;
        }
        case 'CAP': {
          const heading = (o.value as { heading?: unknown }).heading;
          if (typeof heading === 'number') {
            state.applyOptimisticHud({ hdg: heading });
          }
          break;
        }
        case 'TWA': {
          const twa = (o.value as { twa?: unknown }).twa;
          if (typeof twa === 'number') {
            state.applyOptimisticHud({ twa });
          }
          break;
        }
        case 'WPT': {
          const lat = (o.value as { lat?: unknown }).lat;
          const lon = (o.value as { lon?: unknown }).lon;
          if (
            typeof lat === 'number' && typeof lon === 'number'
            && typeof state.hud.lat === 'number' && typeof state.hud.lon === 'number'
          ) {
            const heading = Math.round(
              bearingDeg({ lat: state.hud.lat, lon: state.hud.lon }, { lat, lon }),
            );
            state.applyOptimisticHud({ hdg: heading });
          }
          break;
        }
        // SAIL: capScheduleToOrders / waypointsToOrders rely on auto-sail and
        // don't emit SAIL orders, so nothing to do here.
        default:
          break;
      }
    }

    state.closeRouter();
  };

  const onApply = (mode: 'WAYPOINTS' | 'CAP'): void => {
    const count = useGameStore.getState().prog.orderQueue.length;
    if (count > 0) setPendingApply(mode);
    else performApply(mode);
  };

  // Close the confirm modal if the router panel is closed externally (e.g.
  // user hits Escape, opens another panel, or the router slice resets) so a
  // stale "Replace queue?" prompt cannot orphan-apply against an unrelated
  // computed plan.
  useEffect(() => {
    if (activePanel !== 'router' && pendingApply !== null) {
      setPendingApply(null);
    }
  }, [activePanel, pendingApply]);

  // Defense-in-depth sweep: whenever the computed route becomes null (route
  // applied + router closed, panel switched, dest cleared, etc.) forcibly
  // remove every `sim-route-*` and `sim-iso*` layer + source from the map.
  // RouteLayer/IsochroneLayer already clean themselves up on unmount, but a
  // stale layer reappeared in practice when applying a route (closeRouter →
  // unmount cleanup) raced against the parent re-render driven by the
  // freshly-replaced order queue. Sweeping unconditionally on `routerRoute`
  // becoming null guarantees the map is clean regardless of unmount timing —
  // matches the same pattern used by `installProjectionLayers` in MapCanvas.
  useEffect(() => {
    if (routerRoute !== null) return;
    // Walk the live map style on the next animation frame so any in-flight
    // unmount cleanup of RouteLayer/IsochroneLayer has already landed and we
    // only sweep what was orphaned.
    const handle = requestAnimationFrame(() => {
      const map = mapInstance;
      if (!map) return;
      try {
        const layers = map.getStyle().layers ?? [];
        for (const layer of layers) {
          if (layer.id.startsWith('sim-route-') || layer.id.startsWith('sim-iso')) {
            if (map.getLayer(layer.id)) map.removeLayer(layer.id);
          }
        }
        const sources = map.getStyle().sources ?? {};
        for (const id of Object.keys(sources)) {
          if (id.startsWith('sim-route-') || id.startsWith('sim-iso')) {
            if (map.getSource(id)) map.removeSource(id);
          }
        }
      } catch { /* ignore teardown race */ }
    });
    return () => cancelAnimationFrame(handle);
  }, [routerRoute]);

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

  const handlePanelToggle = (panel: 'ranking' | 'sails' | 'programming' | 'router') => {
    if (activePanel === panel) {
      useGameStore.getState().closePanel();
    } else {
      useGameStore.getState().openPanel(panel);
    }
  };

  if (!gbReady) {
    return (
      <div className={styles.mapSkeleton}>
        <span className={styles.skeletonLabel}>Chargement des paramètres de jeu…</span>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      {/* Row 1 — HUD */}
      <div className={styles.hudRow}>
        {canInteract && <HudBar />}
      </div>

      {/* Row 2 — Map + floating elements */}
      <div className={`${styles.mapArea} ${routerPhase === 'placing' ? styles.mapAreaPlacing : ''}`}>
        <MapCanvas enableProjection={canInteract} />
        <WindOverlay />
        <SwellOverlay />
        {canInteract && <CoordsDisplay />}
        <CursorTooltip />
        {canInteract && <ZoomCompact />}

        {routerPhase === 'placing' && (
          <>
            <div className={styles.placingIndicator}>CLIQUEZ POUR PLACER L&apos;ARRIVÉE</div>
            <button
              type="button"
              className={styles.placingCancelFab}
              onClick={() => useGameStore.getState().exitPlacingMode()}
            >
              ✕ Annuler
            </button>
          </>
        )}

        {routerPanelOpen && routerDest && (
          <RouterDestinationMarker lat={routerDest.lat} lon={routerDest.lon} />
        )}
        {routerPanelOpen && routerRoute && (
          <>
            <IsochroneLayer plan={routerRoute} color="#3a9fff" />
            <RouteLayer
              routes={new Map([['user', routerRoute]])}
              primaryId="user"
              colorFor={() => '#c9a227'}
              nextGfsRunMs={
                decodedGrid?.header?.nextRunExpectedUtc
                  ? decodedGrid.header.nextRunExpectedUtc * 1000
                  : Number.MAX_SAFE_INTEGER
              }
            />
          </>
        )}

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

        {/* Map widgets — bottom-left stack */}
        <div className={styles.leftStack}>
          <WindLegend />
          <LayersWidget isSpectator={!canInteract} />
        </div>

        {/* Ranking tab (left edge — desktop) */}
        <Tooltip text="Classement" shortcut="C" position="bottom" className={styles.rankingTabWrap ?? ''}>
          <button
            className={styles.rankingTab}
            onClick={() => handlePanelToggle('ranking')}
            type="button"
          >
            <span className={styles.rankingTabArrow}>
              {activePanel === 'ranking' ? '◀' : '▶'}
            </span>
            <span className={styles.rankingTabLabel}>CLASSEMENT</span>
            <span className={styles.rankingTabRank}>{rank}</span>
          </button>
        </Tooltip>

        {/* Ranking FAB (mobile) */}
        <button
          className={styles.rankingFab}
          onClick={() => handlePanelToggle('ranking')}
          type="button"
          aria-label="Classement"
        >
          <Trophy size={14} strokeWidth={2.5} />
          <span className={styles.rankingFabRank}>{rank}</span>
        </button>

        {/* Slide-out panels */}
        <SlidePanel side="left" width={320} title="Classement" isOpen={activePanel === 'ranking'} onClose={() => useGameStore.getState().closePanel()}>
          <RankingPanel />
        </SlidePanel>

        {canInteract && (
          <>
            <SlidePanel side="right" width={420} title="Voiles" isOpen={activePanel === 'sails'} onClose={() => useGameStore.getState().closePanel()}>
              <SailPanel />
            </SlidePanel>
            <SlidePanel side="right" width={420} title="Programmation" isOpen={activePanel === 'programming'} onClose={() => useGameStore.getState().closePanel()}>
              <ProgPanel />
            </SlidePanel>
            <SlidePanel
              side="right"
              width={420}
              title="Routeur"
              isOpen={activePanel === 'router'}
              onClose={() => useGameStore.getState().closeRouter()}
              panelClassName={routerPhase === 'placing' ? 'slidePanelPlacingMobileHide' : ''}
            >
              <RouterPanel onApply={onApply} />
            </SlidePanel>
            <ConfirmReplaceProgModal
              isOpen={pendingApply !== null}
              pendingCount={futureOrdersCount}
              onCancel={() => setPendingApply(null)}
              onConfirm={() => {
                if (pendingApply) performApply(pendingApply);
                setPendingApply(null);
              }}
            />
          </>
        )}

        {/* Right stack — action buttons + compass */}
        {canInteract && (
          <div className={styles.rightStack}>
            <div className={styles.actionButtons}>
              <Tooltip text="Gérer les voiles" shortcut="V" position="bottom">
                <button
                  className={`${styles.actionBtn} ${activePanel === 'sails' ? styles.actionBtnActive : ''}`}
                  onClick={() => handlePanelToggle('sails')}
                  type="button"
                >
                  <Sailboat size={18} strokeWidth={2} className={styles.actionBtnIcon} />
                  <span>Voiles</span>
                </button>
              </Tooltip>
              <Tooltip text="Programmer les ordres" shortcut="P" position="bottom">
                <button
                  className={`${styles.actionBtn} ${activePanel === 'programming' ? styles.actionBtnActive : ''}`}
                  onClick={() => handlePanelToggle('programming')}
                  type="button"
                >
                  <Route size={18} strokeWidth={2} className={styles.actionBtnIcon} />
                  <span>Prog.</span>
                </button>
              </Tooltip>
              <Tooltip text="Recentrer sur le bateau" shortcut="Espace" position="bottom">
                <button
                  className={styles.actionBtn}
                  onClick={() => useGameStore.getState().setFollowBoat(true)}
                  type="button"
                >
                  <LocateFixed size={18} strokeWidth={2} className={styles.actionBtnIcon} />
                  <span>Centrer</span>
                </button>
              </Tooltip>
              <Tooltip text="Routeur" shortcut="R" position="bottom">
                <button
                  className={`${styles.actionBtn} ${activePanel === 'router' ? styles.actionBtnActive : ''}`}
                  onClick={() => handlePanelToggle('router')}
                  type="button"
                >
                  <MapPinned size={18} strokeWidth={2} className={styles.actionBtnIcon} />
                  <span>Route</span>
                </button>
              </Tooltip>
            </div>
            <Compass />
          </div>
        )}
      </div>

      {/* Row 3 — Weather timeline */}
      <div className={styles.timelineRow}>
        <WeatherTimeline />
      </div>
    </div>
  );
}
