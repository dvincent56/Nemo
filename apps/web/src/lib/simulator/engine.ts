// apps/web/src/lib/simulator/engine.ts
// Pure SimulatorEngine class — no timers, no side-effects, testable in Node.

import type { Polar, Position, SailId } from '@nemo/shared-types';
import type { BoatClass } from '@nemo/shared-types';
import { GameBalance } from '@nemo/game-balance';
import {
  runTick,
  buildZoneIndex,
  CoastlineIndex,
  resolveBoatLoadout,
  type BoatRuntime,
  type CoastlineProbe,
} from '@nemo/game-engine-core';
import type { WeatherProvider } from '@nemo/game-engine-core';
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
  private polars: Map<string, Polar> = new Map();
  private coastline: CoastlineIndex = new CoastlineIndex();
  private weatherLookup: ReturnType<typeof createWindLookup> | null = null;
  private gribTimestamps: number[] = []; // seconds since epoch

  // Simulation clock
  private simTimeMs: number = 0;
  private startTimeMs: number = 0;
  private speed: SimSpeedFactor = 3600;

  // Saved for reset()
  private initialSetups: SimBoatSetup[] = [];
  private startPos: Position = { lat: 0, lon: 0 };

  private initialized: boolean = false;
  private stopped: boolean = false;

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
      this.polars.set(cls, polar as Polar);
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
        loadout: resolveBoatLoadout(`sim-${setup.id}`, [], setup.boatClass as BoatClass),
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
          const fallback = lookup(lat, lon, this.gribTimestamps[this.gribTimestamps.length - 1]! * 1000);
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

    // GRIB exhaustion check: compare tickStart (ms → s) against last timestamp (s)
    const lastGribTs = this.gribTimestamps[this.gribTimestamps.length - 1];
    if (lastGribTs !== undefined && tickStart / 1000 > lastGribTs) {
      this.listener({ type: 'done', reason: 'grib_exhausted' });
      this.stopped = true;
      return;
    }

    const zones = buildZoneIndex([]);
    let allGrounded = true;

    for (const [id, entry] of this.runtimes) {
      if (entry.grounded) continue;
      allGrounded = false;

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
      entry.prevPos = { ...newPos };
      entry.runtime = outcome.runtime;

      if (outcome.grounded) {
        entry.grounded = true;
      } else {
        allGrounded = false;
      }

      this.runtimes.set(id, entry);
    }

    this.simTimeMs += TICK_MS;

    // Check if all boats are grounded (re-evaluate since some may have just grounded)
    const allNowGrounded = [...this.runtimes.values()].every((e) => e.grounded);
    if (allNowGrounded && this.runtimes.size > 0) {
      this.listener({ type: 'done', reason: 'all_grounded' });
      this.stopped = true;
    }

    void allGrounded; // suppress unused warning
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
