// apps/web/src/lib/simulator/engine.ts
// Pure SimulatorEngine class — no timers, no side-effects, testable in Node.

import type { Polar, Position, SailId } from '@nemo/shared-types';
import type { BoatClass } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance/browser';
import {
  runTick,
  buildZoneIndex,
  CoastlineIndex,
  type BoatRuntime,
  type CoastlineProbe,
} from '@nemo/game-engine-core/browser';
import type { WeatherProvider } from '@nemo/game-engine-core/browser';
import type { WeatherPoint } from '@nemo/shared-types';
import { createWindLookup, type WindGridConfig } from '../projection/windLookup';
import type {
  SimBoatSetup,
  SimFleetState,
  SimInMessage,
  SimOrder,
  SimOrderKind,
  SimOutMessage,
  SimSpeedFactor,
} from './types';

// Tick size in milliseconds — must match game-engine tick interval.
const TICK_MS = 30_000;

/** Haversine distance in nautical miles between two positions. */
function haversineNM(a: Position, b: Position): number {
  const R = 3440.065; // Earth radius in nautical miles
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Listener = (msg: SimOutMessage) => void;

interface RuntimeEntry {
  runtime: BoatRuntime;
  accumulatedNm: number;
  prevPos: Position;
  grounded: boolean;
}

export class SimulatorEngine {
  private listener: Listener;

  // Initialized during init()
  private runtimes: Map<string, RuntimeEntry> = new Map();
  private polars: Map<BoatClass, Polar> = new Map();
  private coastline: CoastlineIndex = new CoastlineIndex();
  private weatherLookup: ReturnType<typeof createWindLookup> | null = null;
  private gribTimestamps: number[] = []; // milliseconds, matching WindGridConfig.timestamps

  // Simulation clock
  private simTimeMs: number = 0;
  private startTimeMs: number = 0;
  private speed: SimSpeedFactor = 3600;

  // Saved for reset()
  private initialSetups: SimBoatSetup[] = [];
  private startPos: Position = { lat: 0, lon: 0 };

  private initialized: boolean = false;
  private stopped: boolean = false;
  private schedules: Map<string, Array<{ triggerMs: number; cap: number; sail?: SailId; plannedLat?: number; plannedLon?: number }>> = new Map();

  constructor(listener: Listener) {
    this.listener = listener;
  }

  setListener(l: Listener): void {
    this.listener = l;
  }

  async init(payload: Extract<SimInMessage, { type: 'init' }>): Promise<void> {
    // 1. Load game balance
    GameBalance.load(payload.gameBalanceJson as never);

    // 2. Cache polars by boat class
    this.polars.clear();
    for (const [cls, polar] of Object.entries(payload.polars)) {
      this.polars.set(cls as BoatClass, polar as Polar);
    }

    // 3. Load coastline
    this.coastline = new CoastlineIndex();
    this.coastline.loadFromGeoJson(payload.coastlineGeoJson as GeoJSON.FeatureCollection);

    // 4. Build weather lookup
    const windGrid = payload.windGrid as WindGridConfig;
    this.weatherLookup = createWindLookup(windGrid, payload.windData as Float32Array);

    // 5. Capture GRIB timestamps (in seconds) for exhaustion checks
    this.gribTimestamps = windGrid.timestamps;

    // 6. Save init params
    this.startPos = { ...payload.startPos };
    this.startTimeMs = payload.startTimeMs;
    this.initialSetups = payload.boats;

    // 7. Build runtimes
    this.simTimeMs = 0;
    this.stopped = false;
    this.buildRuntimes();

    // 8. Mark initialized and emit t=0 snapshot
    this.initialized = true;
    this.emitTick();
  }

  start(): void {
    // The timer loop is managed by the worker adapter (setInterval → advanceSync).
    // This method exists so the worker adapter can call a named method.
  }

  pause(): void {
    // Symmetry with start(). The worker adapter clears the interval.
  }

  setSpeed(factor: SimSpeedFactor): void {
    this.speed = factor;
  }

  reset(): void {
    this.simTimeMs = 0;
    this.stopped = false;
    this.schedules.clear();
    this.buildRuntimes();
    this.emitTick();
  }

  /**
   * Apply an order to all boats immediately.
   * triggerSimMs exists for protocol symmetry but is unused in v1 — all orders
   * are applied instantly to all runtimes.
   */
  order(order: SimOrder, _triggerSimMs: number): void {
    for (const entry of this.runtimes.values()) {
      const seg = entry.runtime.segmentState;
      switch (order.kind as SimOrderKind) {
        case 'CAP':
          seg.heading = order.value as number;
          seg.twaLock = null;
          break;
        case 'TWA':
          seg.twaLock = order.value as number;
          break;
        case 'SAIL':
          seg.sail = order.value as SailId;
          break;
        case 'MODE':
          seg.sailAuto = order.value as boolean;
          break;
      }
    }
  }

  setSchedule(boatId: string, entries: Array<{ triggerMs: number; cap: number; sail?: SailId; plannedLat?: number; plannedLon?: number }>): void {
    const sorted = [...entries].sort((a, b) => a.triggerMs - b.triggerMs);
    this.schedules.set(boatId, sorted);
    console.log(
      `[sim-schedule] set boat=${boatId} · ${sorted.length} entries · first trigger=${sorted[0]?.triggerMs} · startTime=${this.startTimeMs} · delta=${sorted[0] ? ((sorted[0].triggerMs - this.startTimeMs) / 1000).toFixed(0) + 's' : 'n/a'}`,
    );
  }

  /**
   * Advance simulation by realMs of real time.
   * Internally multiplied by the speed factor to get simulated time.
   */
  advanceSync(realMs: number): void {
    if (!this.initialized || this.stopped) return;

    const targetSimMs = this.simTimeMs + realMs * this.speed;
    while (this.simTimeMs + TICK_MS <= targetSimMs && !this.stopped) {
      this.stepOneTick();
    }
    this.emitTick();
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private buildRuntimes(): void {
    this.runtimes.clear();
    for (const setup of this.initialSetups) {
      const boat = {
        id: setup.id,
        ownerId: setup.id,
        name: setup.name,
        boatClass: setup.boatClass as BoatClass,
        position: { ...this.startPos },
        heading: 90,
        bsp: 0,
        sail: setup.initialSail,
        sailState: 'STABLE' as const,
        hullCondition: 100,
        rigCondition: 100,
        sailCondition: 100,
        elecCondition: 100,
      };

      const runtime: BoatRuntime = {
        boat,
        raceId: 'simulator',
        condition: { ...setup.initialCondition },
        sailState: {
          active: setup.initialSail,
          pending: null,
          transitionStartMs: 0,
          transitionEndMs: 0,
          autoMode: false,
          timeOutOfRangeSec: 0,
        },
        segmentState: {
          position: { ...this.startPos },
          heading: 90,
          twaLock: null,
          sail: setup.initialSail,
          sailAuto: false,
        },
        orderHistory: [],
        zonesAlerted: new Set(),
        loadout: setup.loadout,
        prevTwa: null,
        maneuver: null,
      };

      this.runtimes.set(setup.id, {
        runtime,
        accumulatedNm: 0,
        prevPos: { ...this.startPos },
        grounded: false,
      });
    }
  }

  private stepOneTick(): void {
    // Build a CoastlineProbe adapter from the CoastlineIndex
    const coastlineIndex = this.coastline;
    const probe: CoastlineProbe = {
      isLoaded: () => coastlineIndex.isLoaded(),
      segmentCrossesCoast: (from, to, n) => coastlineIndex.segmentCrossesCoast(from, to, n),
      coastRiskLevel: (lat, lon) => coastlineIndex.coastRiskLevel(lat, lon),
    };

    // Build a WeatherProvider from the windLookup
    const lookup = this.weatherLookup!;
    const weather: WeatherProvider = {
      runTs: this.startTimeMs / 1000,
      getForecastAt: (lat: number, lon: number, timeUnix: number): WeatherPoint => {
        // createWindLookup takes timeMs, but getForecastAt receives timeUnix (seconds)
        const sample = lookup(lat, lon, timeUnix * 1000);
        if (!sample) {
          // Beyond GRIB coverage: return last valid sample (static fallback)
          const fallback = lookup(lat, lon, this.gribTimestamps[this.gribTimestamps.length - 1]!);
          if (fallback) {
            return {
              tws: fallback.tws,
              twd: fallback.twd,
              swh: fallback.swh,
              mwd: fallback.swellDir,
              mwp: fallback.swellPeriod,
            };
          }
          return { tws: 0, twd: 0, swh: 0, mwd: 0, mwp: 0 };
        }
        return {
          tws: sample.tws,
          twd: sample.twd,
          swh: sample.swh,
          mwd: sample.swellDir,
          mwp: sample.swellPeriod,
        };
      },
    };

    const tickStart = this.simTimeMs + this.startTimeMs;
    const tickEnd = tickStart + TICK_MS;

    // Apply any scheduled orders whose trigger lies in [0, tickEnd)
    for (const [id, entries] of this.schedules) {
      const pbr = this.runtimes.get(id);
      if (!pbr) continue;
      while (entries.length > 0 && entries[0]!.triggerMs <= tickEnd) {
        const entry = entries.shift() as {
          triggerMs: number; cap: number; sail?: SailId;
          plannedLat?: number; plannedLon?: number;
        };
        const prevHdg = pbr.runtime.segmentState.heading;
        pbr.runtime.segmentState.heading = entry.cap;
        pbr.runtime.segmentState.twaLock = null;
        if (entry.sail) pbr.runtime.segmentState.sail = entry.sail;
        const pos = pbr.runtime.boat.position;
        let deltaInfo = '';
        if (entry.plannedLat !== undefined && entry.plannedLon !== undefined) {
          const R = 3440.065;
          const toRad = Math.PI / 180;
          const dLat = (pos.lat - entry.plannedLat) * toRad;
          const dLon = (pos.lon - entry.plannedLon) * toRad;
          const lat1 = entry.plannedLat * toRad;
          const lat2 = pos.lat * toRad;
          const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
          const deltaNm = 2 * R * Math.asin(Math.sqrt(h));
          deltaInfo = ` · planned=(${entry.plannedLat.toFixed(3)}, ${entry.plannedLon.toFixed(3)}) · actual=(${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}) · ΔNm=${deltaNm.toFixed(2)}`;
        }
        console.log(
          `[sim-schedule] boat=${id} simT=${(this.simTimeMs / 3_600_000).toFixed(2)}h · ${prevHdg.toFixed(0)}° → ${entry.cap.toFixed(0)}°${entry.sail ? ' · sail=' + entry.sail : ''} · remaining=${entries.length}${deltaInfo}`,
        );
      }
    }

    // GRIB exhaustion: tickStart is ms, timestamps are ms — compare directly
    const lastGribTs = this.gribTimestamps[this.gribTimestamps.length - 1];
    if (lastGribTs !== undefined && tickStart > lastGribTs) {
      this.listener({ type: 'done', reason: 'grib_exhausted' });
      this.stopped = true;
      return;
    }

    const zones = buildZoneIndex([]);

    for (const [id, entry] of this.runtimes) {
      if (entry.grounded) continue;

      const polar = this.polars.get(entry.runtime.boat.boatClass);
      if (!polar) {
        console.warn(`[SimulatorEngine] No polar for boat class: ${entry.runtime.boat.boatClass}`);
        continue;
      }

      const outcome = runTick(
        entry.runtime,
        { polar, weather, zones, coastline: probe },
        tickStart,
        tickEnd,
      );

      const newPos = outcome.runtime.boat.position;
      entry.accumulatedNm += haversineNM(entry.prevPos, newPos);

      // Sample the sim's BSP every 60 ticks (= 30 min of sim time) so we
      // can compare to the router's expected BSP. Log shape mirrors
      // [routing-plan] lines for easy pairing in the console.
      if (this.simTimeMs % (30 * 60_000) === 0) {
        console.log(
          `[sim-tick] boat=${id} simT=${(this.simTimeMs / 3_600_000).toFixed(2)}h · hdg=${outcome.runtime.segmentState.heading.toFixed(0)}° · sail=${outcome.runtime.segmentState.sail} · bsp=${outcome.bsp.toFixed(2)} · tws=${outcome.tws.toFixed(1)} · twa=${outcome.twa.toFixed(0)}° · pos=(${newPos.lat.toFixed(3)}, ${newPos.lon.toFixed(3)})`,
        );
      }

      entry.prevPos = { ...newPos };
      entry.runtime = outcome.runtime;

      if (outcome.grounded) entry.grounded = true;
      this.runtimes.set(id, entry);
    }

    this.simTimeMs += TICK_MS;

    if (this.runtimes.size > 0 && [...this.runtimes.values()].every((e) => e.grounded)) {
      this.listener({ type: 'done', reason: 'all_grounded' });
      this.stopped = true;
    }
  }

  private emitTick(): void {
    const fleet: Record<string, SimFleetState> = {};

    for (const [id, entry] of this.runtimes) {
      const { runtime, accumulatedNm } = entry;
      fleet[id] = {
        position: { ...runtime.boat.position },
        heading: runtime.boat.heading,
        bsp: runtime.boat.bsp,
        twa: runtime.prevTwa ?? 0,
        sail: runtime.boat.sail,
        condition: { ...runtime.condition },
        distanceNm: Number(accumulatedNm.toFixed(4)),
      };
    }

    this.listener({ type: 'tick', simTimeMs: this.simTimeMs, fleet });
  }
}
