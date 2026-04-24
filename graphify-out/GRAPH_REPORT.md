# Graph Report - Project Nemo  (2026-04-24)

## Corpus Check
- 274 files · ~351,181 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 928 nodes · 1108 edges · 101 communities detected
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 221 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 108|Community 108]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 112|Community 112]]
- [[_COMMUNITY_Community 113|Community 113]]

## God Nodes (most connected - your core abstractions)
1. `runTick()` - 24 edges
2. `computeRoute` - 22 edges
3. `SimulatorEngine` - 15 edges
4. `main() bootstrap` - 14 edges
5. `registerMarinaRoutes` - 14 edges
6. `GameStore` - 14 edges
7. `apiFetch` - 13 edges
8. `createNoaaProvider` - 12 edges
9. `Compass` - 12 edges
10. `UI Barrel Exports` - 12 edges

## Surprising Connections (you probably didn't know these)
- `convert-polar-csv.mjs (qtVLM CSV → Nemo)` --rationale_for--> `Polar JSON dual-location sync rule`  [INFERRED]
  scripts/convert-polar-csv.mjs → CLAUDE.md
- `240h horizon cap (GFS forecast limit)` --conceptually_related_to--> `NOAA GFS ingestion pipeline`  [INFERRED]
  packages/routing/src/presets.ts → apps/weather-engine/README.md
- `BoatClass type` --rationale_for--> `Prefer Record<BoatClass,X> over Record<string,X>`  [INFERRED]
  packages/shared-types/src/index.ts → CLAUDE.md
- `parseInline(markdownish)` --semantically_similar_to--> `SvgPatternDef`  [AMBIGUOUS] [semantically similar]
  apps/web/src/app/news/[slug]/NewsArticle.tsx → apps/web/src/app/marina/[boatId]/customize/CustomizeView.tsx
- `getPolarSpeed` --semantically_similar_to--> `getPolarSpeed()`  [INFERRED] [semantically similar]
  apps/web/src/lib/polar.ts → apps\web\src\lib\projection\simulate.ts

## Hyperedges (group relationships)
- **Tick -> Payload -> Redis -> WS broadcast pipeline** — manager_on_tick_done, payload_build_full_update, redis_channels, worker_main [INFERRED 0.90]
- **Purchase+Install upgrade atomic transaction** — marina_buy_and_install_route, db_schema_player_upgrades, db_schema_boat_installed_upgrades, marina_helpers_meets_unlock_criteria [EXTRACTED 0.95]
- **Order flow: WS -> ingest -> redis -> worker tick** — orders_ingest_on_order_received, manager_subscribe_orders, worker_main, orders_tick_order_queue [INFERRED 0.85]
- **NOAA GFS Ingest Pipeline** — ingest_ingest_run, grid_builder_parse_atmos_grib, grid_builder_parse_wave, persistence_push_hour, persistence_push_meta, provider_create_noaa_provider [INFERRED 0.90]
- **Weather Blend Forecast Flow** — provider_create_noaa_provider, blend_blend_grid_forecast, blend_is_blend_complete, provider_blend_state, provider_redis_subscribe [EXTRACTED 1.00]
- **Engine Tick E2E Test Suite** — e2e_tick_main, e2e_phase2_main, e2e_segments_main, bench_tick_scaling_tier1, concept_run_tick [INFERRED 0.90]
- **Places cascade (country → subdivision → city)** — placescountries_get, placessubdivisions_get, placescities_get [INFERRED 0.95]
- **Home landing page stack** — pagetsx_homepage, homeview_homeview, homedatats_news_seed [INFERRED 0.90]
- **Dev simulator fleet/routing layers** — devsimulatorclient_component, fleetlayer_component, endpointlayer_component [INFERRED 0.90]
- **Simulator map layers (share mapInstance + lifecycle pattern)** — isochronelayer_component, routelayer_component, projectionlayer_component_sim, startpointlayer_component [INFERRED 0.85]
- **Marina slot customization workflow** — boatdetailview_component, slotcard_component, slotdrawer_component [INFERRED 0.90]
- **Simulator order input + history pipeline** — setuppanel_component, orderinput_component, orderhistory_component [INFERRED 0.85]
- **Profile settings PATCH suite (stubs Phase 4)** — profile_settings_api_updateidentity, profile_settings_api_updateaccount, profile_settings_api_updatepreferences [EXTRACTED 0.95]
- **Friendship/invitation lifecycle** — profile_social_api_searchplayers, profile_social_api_addfriend, profile_social_api_acceptinvitation [EXTRACTED 0.92]
- **Play page bootstrap (session + balance + boat init)** — playclient_component, playclient_useboatinit, playclient_bootstrapgamebalance [INFERRED 0.90]
- **Ranking views family (season/race/teams)** — rankingview_component, rankingraceview_component, ranking_teams_page [INFERRED 0.90]
- **Play HUD cluster (Compass/HUD/Sail share game state)** — compass_component, hudbar_component, sailpanel_component [INFERRED 0.90]
- **Map weather overlays (WebGL particles + cursor tooltip)** — windoverlay_component, swelloverlay_component, cursortooltip_component [INFERRED 0.88]
- **Nemo Luxury UI Kit (primitives exposed via barrel)** — button_tsx_button, card_tsx_card, chip_tsx_chip [INFERRED 0.88]
- **SiteShell composition (topbar + footer + session)** — site_shell_tsx_site_shell, topbar_tsx_topbar, site_footer_tsx_site_footer [EXTRACTED 0.95]
- **Weather prefetch pipeline (status polling + global + tactical)** — use_gfs_status_ts_use_gfs_status, use_weather_prefetch_ts_use_weather_prefetch, use_tactical_tile_ts_use_tactical_tile [INFERRED 0.90]
- **BSP calculation chain in projection/simulate** — simulate_computeBsp, simulate_getPolarSpeed, simulate_swellSpeedFactor [EXTRACTED 0.95]
- **Zustand game store slice composition** — storeIndex_useGameStore, hudSlice_createHudSlice, mapSlice_createMapSlice [EXTRACTED 0.95]
- **Dev simulator pipeline (engine + freeze + fixtures)** — simEngine_SimulatorEngine, projectionFreeze_freezeProjection, testFixtures_makeBoat [INFERRED 0.85]
- **Zustand slice composition** — types_game_store, sailslice_createsailslice, weatherslice_createweatherslice [INFERRED 0.90]
- **Weather grid binary pipeline** — prefetch_fetchweathergrid, binarydecoder_decodeweathergrid, gridfrombinary_decodedgridtoweathergridatnow [INFERRED 0.90]
- **Projection simulation control flow** — projection_worker_simulate, projection_worker_pickoptimalsail, projection_worker_getstepsize [EXTRACTED 0.95]
- **Tick pipeline (sails + segments + wear + zones)** — tick_run, segments_build, loadout_aggregate_effects [INFERRED 0.90]
- **GameBalance singleton consumers (wear/sails/zones)** — game_balance_browser_singleton, wear_compute_delta, sails_advance_state [INFERRED 0.85]
- **Coastline grounding detection (index + probe + tick)** — coastline_index_class, tick_coastline_probe_type, tick_run [INFERRED 0.85]
- **Isochrone routing pipeline (wind → candidates → prune → backtrack → schedule)** — weather_sampler_sample_wind, isochrones_compute_route, pruning_prune_by_sector [INFERRED 0.90]
- **BoatClass SoT chain (tuple → type → runbook guidance)** — shared_types_boat_classes_tuple, shared_types_boat_class, runbook_source_of_truth_chain_concept [EXTRACTED 0.95]
- **External polar ingestion scripts (CSV/XML/VR → Nemo JSON)** — convert_polar_csv_script, convert_polar_xml_script, convert_vr_polars_script [INFERRED 0.88]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (64): bandFor, benchN, buildRuntime, CLASS40 bench boat, Tier 1 CPU Scaling Bench, build-fixture main, Fixture TWS ramp 12/22/28/32 kts, GameBalance.loadFromDisk bootstrap (+56 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (62): Prefer Record<BoatClass,X> over Record<string,X>, convert-polar-csv.mjs (qtVLM CSV → Nemo), convert-polar-xml.mjs (Bureau Vallée XML → Nemo), convert-vr-polars.ts (VR toxcct → Nemo), chaikin(), isoToFeatures(), smoothRadially(), Check arrival before sector pruning (+54 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (54): POST /api/v1/auth/dev-login, POST /api/v1/auth/exchange, POST /api/v1/auth/logout, GET /api/v1/auth/me, registerAuthRoutes, AuthContext type, authPreHandler, enforceAuth (+46 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (51): decodeHeader, encodeGridSubset, GRID_VERSION=2 (float32|int16), Int16 quantization with sentinel NaN, Resolution stride downsampling, binary-encoder tests, BLEND_DURATION_MS (1h), blendGridForecast (+43 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (48): bench-broadcast (Tier 2 scaling), coastRiskLevel, distanceToCoastNmFast, distanceToCoastNm, global CoastlineIndex, CoastlineIndex, loadCoastline, segmentCrossesCoast (+40 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (50): Backend schema gaps (Phase 4 tables), Country -> Subdivision -> City cascade, Dirty vs baseline pattern, CustomizeLoader, CustomizeView, darken(hex, amount), HexPicker, ImocaPreview (+42 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (39): @/lib/access (parseDevToken, readClientSession), fetchRaces (@/lib/api), CLASS_LABEL (@/lib/boat-classes), NewsItem / NewsBlock types, fetchNews, fetchNewsBySlug, @/app/ranking/data (PLAYERS, getRanking, etc.), profileHref (@/lib/routes) (+31 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (36): DecodedWeatherGrid, decodeWeatherGrid, getPointAt, HEADER_SIZE, decodeWeatherGrid tests, WeatherGridHeader, interpolateGfsWind, msToKnots (+28 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (35): BoatSvg, darken, apply (Compass order commit), Compass, isInVmgZone, toggleTwaLock, WindWaves, @/lib/mapAppearance (OCEAN_PRESETS, findOceanPreset) (+27 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (24): ComparisonPanel, WearBar, MapLibre side-effect layer manager pattern, colorFor(), fetchRoutingAssets(), fetchSimAssets(), launch(), rerouteFromCurrent() (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (28): DEFAULT_TIMEOUT_MS, mergeField, PendingField, mergeField tests, createPreviewSlice, INITIAL_PREVIEW, PreviewState, createProgSlice (+20 more)

### Community 11 - "Community 11"
Cohesion: 0.1
Nodes (27): ANONYMOUS, parseDevToken, readClientSession, Role, SessionContext, Button, Card, Chip (+19 more)

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (26): GET /api/public/news, GET /api/public/news/[slug], GET /api/v1/races/:raceId/my-boat, GET /api/v1/races/:raceId/zones, nemo_access_token auth cookie, Public (visitor-accessible) routes, HERO_STATS (mock), NEWS_SEED (mock) (+18 more)

### Community 13 - "Community 13"
Cohesion: 0.13
Nodes (25): BoatDetailPage, BoatDetailView, aggregateInstalledEffects, Bar (EffectsSummary), EffectsSummary, detailLines, itemNotes, summarizeEffects (+17 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (23): GFS-freshness polyline split, lib/boat-classes, mapInstance (MapCanvas), lib/projection/types, lib/simulator/types, useSimulatorWorker, OrderHistory, fmtOrder (+15 more)

### Community 15 - "Community 15"
Cohesion: 0.14
Nodes (15): engine sails.pickOptimalSail, ALL_SAILS, pickOptimalSail, findBracket, getPolarSpeed, clamp01(), computeBsp(), computeWearDelta() (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (20): CoastlineIndex, intersect, engine CoastlineIndex, ensureBalance, ensureCoastline (projection), getStepSize, pickOptimalSail (worker), projection worker simulate (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (9): courseLengthNM(), haversine(), haversineKm(), haversineKmScalar(), haversineNM(), haversinePosKm(), haversinePosNM(), bspRatioToRgb() (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (4): SimulatorEngine, createFallbackWindLookup, buildZoneIndex, getZonesAtPosition

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (16): Spectator access gating (canInteract), decideRaceAccess, GameBalance (browser), useHotkeys, useTacticalTile, useWeatherPrefetch, fetchMyBoat, fetchRace (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (15): AccessMode, decideRaceAccess, spectateBanner, API_BASE, BoatEffects, BoatState, fetchMyBoat, fetchNews (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (15): lib/api, createHudSlice, apiFetch, buyAndInstall, createBoat, fetchBoatDetail, fetchCatalog, fetchMyBoats (+7 more)

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (3): sendOrder(), isObsolete(), handleCommit()

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (14): BoatClass single-source-of-truth rule, game-balance.json duplication rule, Graphify knowledge graph rules, MARINA_BOAT_CLASSES manual maintenance rule, Polar JSON dual-location sync rule, CLAUDE.md — Project Nemo instructions, Nemo — README project overview, Spec priority V3 > V2 > V1 (+6 more)

### Community 24 - "Community 24"
Cohesion: 0.24
Nodes (11): prefetch payload budget tests, DEFAULT_BOUNDS, DEFAULT_RESOLUTION, PREFETCH_HOURS_PHASE1, PREFETCH_HOURS_PHASE2, PREFETCH_HOURS_TTFW, prefetch constants tests, computeTileBounds (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (9): GET /api/v1/places/cities, GET /api/v1/places/countries, CityDto, CountryDto, FR_COMMUNES (Etalab), FR_DEPARTEMENTS (Etalab), normalizeCountry(), SubdivisionDto (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (5): WindGridConfig (engine), ClientCtx, extractRaceId, ws-gateway main, verifyToken

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (6): createMapAppearanceSlice, DEFAULT_OCEAN_ID, OCEAN_PRESETS, STORAGE_KEY, findOceanPreset, validateCatalogs

### Community 28 - "Community 28"
Cohesion: 0.5
Nodes (5): POST /boats/:id/install, Racing boat install lock, marina e2e main, POST /upgrades/purchase, GET /upgrades/catalog

### Community 29 - "Community 29"
Cohesion: 0.4
Nodes (4): BOAT_FILES Record<BoatClass,string>, GET /api/v1/polars/[boatClass], headers() /data/* Cache-Control, transpilePackages (@nemo/*)

### Community 30 - "Community 30"
Cohesion: 0.5
Nodes (5): Dev login flow (token dev.<sub>.<username>), lib/api (API_BASE), devLogin, LoginPage, submit (login)

### Community 31 - "Community 31"
Cohesion: 0.5
Nodes (2): ALL_SAILS catalog, BoatSetupModal

### Community 32 - "Community 32"
Cohesion: 0.5
Nodes (4): Order interface, OrderEnvelope (event-sourced), OrderTrigger union, OrderType

### Community 33 - "Community 33"
Cohesion: 0.5
Nodes (4): ExclusionZone, ExclusionZoneCategory (DST/ZEA/ZPC/ZES), ExclusionZoneType (WARN/PENALTY), GeoJsonPolygon

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (2): load_from_disk, save_to_disk

### Community 36 - "Community 36"
Cohesion: 0.67
Nodes (3): useGfsStatus, useTacticalTile, useWeatherPrefetch

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (3): CatalogEffects, CatalogItem, InstalledUpgrade

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (3): POLAR_FILES, getCachedPolar, loadPolar

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): projectionAt, ProjectionResult, readProjectionPoint

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): CGUPage, CookiesPage

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (2): effectiveForDisplay, mergePassive

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (2): BOAT_CLASS_ORDER, CLASS_LABEL

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (2): loadFixtureGameBalance, makeBoat

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (2): createPanelSlice, useHotkeys

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (2): createSelectionSlice, INITIAL_SELECTION

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (2): createTimelineSlice, INITIAL_TIMELINE

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (2): createZonesSlice, INITIAL_ZONES

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (1): UnlockCriteria interface

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (1): encodeBatch (msgpack)

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (1): insertDirectOrder

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (1): RootLayout

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): Google Fonts (Grotesk/Bebas/Mono)

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (1): OrderHistoryEntry

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (1): FormState

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (1): RoutingControls

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (1): SLOT_LABEL

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (1): TIER_LABEL

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (1): BoatDetail

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (1): BoatRaceHistoryEntry

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (1): removeFriend

### Community 68 - "Community 68"
Cohesion: 1.0
Nodes (1): getTeamSlugForName

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (1): SlidePanel

### Community 71 - "Community 71"
Cohesion: 1.0
Nodes (1): WindLegend

### Community 73 - "Community 73"
Cohesion: 1.0
Nodes (1): ButtonProps

### Community 74 - "Community 74"
Cohesion: 1.0
Nodes (1): CardProps

### Community 75 - "Community 75"
Cohesion: 1.0
Nodes (1): ChipProps

### Community 76 - "Community 76"
Cohesion: 1.0
Nodes (1): DrawerLink

### Community 77 - "Community 77"
Cohesion: 1.0
Nodes (1): useSimulatorWorker

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (1): OceanPreset

### Community 79 - "Community 79"
Cohesion: 1.0
Nodes (1): BoatRecord

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (1): InventoryItem

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (1): Country

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (1): Subdivision

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (1): City

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (1): fetchCountries

### Community 85 - "Community 85"
Cohesion: 1.0
Nodes (1): fetchSubdivisions

### Community 86 - "Community 86"
Cohesion: 1.0
Nodes (1): fetchCities

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (1): profileHref

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (1): CoastSegment

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (1): WorkerOutMessage

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (1): WeatherAtPoint

### Community 92 - "Community 92"
Cohesion: 1.0
Nodes (1): loadFixturePolars

### Community 93 - "Community 93"
Cohesion: 1.0
Nodes (1): SimBoatSetup

### Community 94 - "Community 94"
Cohesion: 1.0
Nodes (1): SimFleetState

### Community 95 - "Community 95"
Cohesion: 1.0
Nodes (1): SimInMessage

### Community 96 - "Community 96"
Cohesion: 1.0
Nodes (1): SimOutMessage

### Community 97 - "Community 97"
Cohesion: 1.0
Nodes (1): createConnectionSlice

### Community 98 - "Community 98"
Cohesion: 1.0
Nodes (1): INITIAL_HUD

### Community 99 - "Community 99"
Cohesion: 1.0
Nodes (1): createLayersSlice

### Community 100 - "Community 100"
Cohesion: 1.0
Nodes (1): createMapSlice

### Community 101 - "Community 101"
Cohesion: 1.0
Nodes (1): ZonesState

### Community 102 - "Community 102"
Cohesion: 1.0
Nodes (1): WindAtPoint

### Community 103 - "Community 103"
Cohesion: 1.0
Nodes (1): SwellAtPoint

### Community 104 - "Community 104"
Cohesion: 1.0
Nodes (1): getPointsAtTime

### Community 105 - "Community 105"
Cohesion: 1.0
Nodes (1): GameBalance (game-balance)

### Community 107 - "Community 107"
Cohesion: 1.0
Nodes (1): WeatherProvider

### Community 108 - "Community 108"
Cohesion: 1.0
Nodes (1): WeatherPoint

### Community 110 - "Community 110"
Cohesion: 1.0
Nodes (1): Try to extract wave variables from the atmospheric GRIB (0.25° global).     GFS

### Community 111 - "Community 111"
Cohesion: 1.0
Nodes (1): NOAA GFS ingest — continuous polling and ingestion.

### Community 112 - "Community 112"
Cohesion: 1.0
Nodes (1): Push a single forecast hour to Redis (~33 MB per key).

### Community 113 - "Community 113"
Cohesion: 1.0
Nodes (1): Push run metadata + notify subscribers.

## Ambiguous Edges - Review These
- `NewsItem interface` → `GET /api/v1/races/:raceId/my-boat`  [AMBIGUOUS]
  apps/web/src/app/api/v1/races/[raceId]/my-boat/route.ts · relation: semantically_similar_to
- `SvgPatternDef` → `parseInline(markdownish)`  [AMBIGUOUS]
  apps/web/src/app/news/[slug]/NewsArticle.tsx · relation: semantically_similar_to

## Knowledge Gaps
- **363 isolated node(s):** `Drizzle Kit Config`, `Demo Boat (r-vendee-2026)`, `POST /api/v1/auth/exchange`, `POST /api/v1/auth/logout`, `UnlockCriteria interface` (+358 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 31`** (4 nodes): `ALL_SAILS catalog`, `BoatSetupModal`, `defaultSlotSelections()`, `getSlotItems()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (3 nodes): `load_from_disk`, `save_to_disk`, `test_persistence.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `CGUPage`, `CookiesPage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `effectiveForDisplay`, `mergePassive`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `BOAT_CLASS_ORDER`, `CLASS_LABEL`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `loadFixtureGameBalance`, `makeBoat`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `createPanelSlice`, `useHotkeys`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `createSelectionSlice`, `INITIAL_SELECTION`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `createTimelineSlice`, `INITIAL_TIMELINE`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `createZonesSlice`, `INITIAL_ZONES`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `UnlockCriteria interface`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `encodeBatch (msgpack)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `insertDirectOrder`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `RootLayout`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `Google Fonts (Grotesk/Bebas/Mono)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `OrderHistoryEntry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `FormState`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `RoutingControls`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `SLOT_LABEL`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `TIER_LABEL`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `BoatDetail`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `BoatRaceHistoryEntry`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `removeFriend`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (1 nodes): `getTeamSlugForName`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (1 nodes): `SlidePanel`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (1 nodes): `WindLegend`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (1 nodes): `ButtonProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (1 nodes): `CardProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (1 nodes): `ChipProps`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (1 nodes): `DrawerLink`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (1 nodes): `useSimulatorWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (1 nodes): `OceanPreset`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (1 nodes): `BoatRecord`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (1 nodes): `InventoryItem`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (1 nodes): `Country`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (1 nodes): `Subdivision`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (1 nodes): `City`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (1 nodes): `fetchCountries`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (1 nodes): `fetchSubdivisions`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (1 nodes): `fetchCities`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (1 nodes): `profileHref`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (1 nodes): `CoastSegment`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (1 nodes): `WorkerOutMessage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (1 nodes): `WeatherAtPoint`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (1 nodes): `loadFixturePolars`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (1 nodes): `SimBoatSetup`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (1 nodes): `SimFleetState`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (1 nodes): `SimInMessage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (1 nodes): `SimOutMessage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (1 nodes): `createConnectionSlice`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (1 nodes): `INITIAL_HUD`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 99`** (1 nodes): `createLayersSlice`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (1 nodes): `createMapSlice`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (1 nodes): `ZonesState`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (1 nodes): `WindAtPoint`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (1 nodes): `SwellAtPoint`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (1 nodes): `getPointsAtTime`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (1 nodes): `GameBalance (game-balance)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (1 nodes): `WeatherProvider`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 108`** (1 nodes): `WeatherPoint`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 110`** (1 nodes): `Try to extract wave variables from the atmospheric GRIB (0.25° global).     GFS`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (1 nodes): `NOAA GFS ingest — continuous polling and ingestion.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 112`** (1 nodes): `Push a single forecast hour to Redis (~33 MB per key).`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 113`** (1 nodes): `Push run metadata + notify subscribers.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `NewsItem interface` and `GET /api/v1/races/:raceId/my-boat`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `SvgPatternDef` and `parseInline(markdownish)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `SimulatorEngine` connect `Community 18` to `Community 9`, `Community 4`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **Why does `runTick()` connect `Community 0` to `Community 1`, `Community 18`, `Community 4`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Why does `main() bootstrap` connect `Community 4` to `Community 2`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Are the 23 inferred relationships involving `runTick()` (e.g. with `.stepOneTick()` and `aggregateEffects`) actually correct?**
  _`runTick()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `computeRoute` (e.g. with `inConeFrom heading cone` and `Sub-step wind resampling (SUB_STEPS=8)`) actually correct?**
  _`computeRoute` has 6 INFERRED edges - model-reasoned connections that need verification._