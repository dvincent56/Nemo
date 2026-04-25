import {
  pgTable,
  uuid,
  varchar,
  integer,
  smallint,
  timestamp,
  text,
  jsonb,
  boolean,
  decimal,
  doublePrecision,
  unique,
  real,
  pgEnum,
  check,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tierEnum = pgEnum('tier', ['FREE', 'CAREER']);
export const boatStatusEnum = pgEnum('boat_status', ['ACTIVE', 'SOLD', 'ARCHIVED']);
export const raceStatusEnum = pgEnum('race_status', [
  'DRAFT', 'PUBLISHED', 'BRIEFING', 'LIVE', 'FINISHED', 'ARCHIVED',
]);
export const gateTypeEnum = pgEnum('gate_type', ['GATE', 'MARK', 'FINISH']);
export const zoneTypeEnum = pgEnum('zone_type', ['WARN', 'PENALTY']);
export const orderTypeEnum = pgEnum('order_type', ['CAP', 'TWA', 'WPT', 'SAIL', 'MODE', 'VMG']);

export const upgradeAcquisitionSourceEnum = pgEnum('upgrade_acquisition_source', [
  'PURCHASE',
  'ACHIEVEMENT_UNLOCK',
  'BOAT_SOLD_RETURN',
  'ADMIN_GRANT',
  'GIFT',
  'MIGRATION',
]);

export const upgradeSlotEnum = pgEnum('upgrade_slot', [
  'HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT',
]);

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  cognitoSub: varchar('cognito_sub', { length: 128 }).notNull().unique(),
  username: varchar('username', { length: 40 }).notNull().unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  tier: tierEnum('tier').notNull().default('FREE'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 64 }),
  credits: integer('credits').notNull().default(500),
  rankingScore: integer('ranking_score').notNull().default(0),
  racesFinished: integer('races_finished').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  podiums: integer('podiums').notNull().default(0),
  top10Finishes: integer('top10_finishes').notNull().default(0),
  avgRankPct: real('avg_rank_pct').notNull().default(0),
  totalNm: real('total_nm').notNull().default(0),
  currentStreak: integer('current_streak').notNull().default(0),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('credits_non_negative', sql`${t.credits} >= 0`),
]);

export const races = pgTable('races', {
  // Slug public (ex. "r-vendee-2026") — utilisé dans les URLs /play/:raceId.
  id: text('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  description: text('description'),
  coverImageUrl: text('cover_image_url'),
  status: raceStatusEnum('status').notNull().default('DRAFT'),
  boatClass: varchar('boat_class', { length: 20 }).notNull(),
  tierRequired: tierEnum('tier_required').notNull().default('FREE'),
  courseGeoJson: jsonb('course_geojson').notNull(),
  registrationOpensAt: timestamp('registration_opens_at', { withTimezone: true }),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  estimatedDurationHours: integer('estimated_duration_hours'),
  maxParticipants: integer('max_participants'),
  rewardsConfig: jsonb('rewards_config'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const boats = pgTable('boats', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 50 }).notNull(),
  boatClass: varchar('boat_class', { length: 20 }).notNull(),
  hullColor: varchar('hull_color', { length: 7 }),
  hullTextureUrl: text('hull_texture_url'),
  sailTextureUrl: text('sail_texture_url'),
  generation: smallint('generation').notNull().default(1),
  currentValue: integer('current_value').notNull().default(0),
  activeRaceId: text('active_race_id').references(() => races.id, { onDelete: 'set null' }),
  hullCondition: smallint('hull_condition').notNull().default(100),
  rigCondition: smallint('rig_condition').notNull().default(100),
  sailCondition: smallint('sail_condition').notNull().default(100),
  elecCondition: smallint('elec_condition').notNull().default(100),
  racesCount: integer('races_count').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  podiums: integer('podiums').notNull().default(0),
  top10Finishes: integer('top10_finishes').notNull().default(0),
  notableRaces: text('notable_races').array(),
  status: boatStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('hull_condition_range', sql`${t.hullCondition} >= 0 AND ${t.hullCondition} <= 100`),
  check('rig_condition_range', sql`${t.rigCondition} >= 0 AND ${t.rigCondition} <= 100`),
  check('sail_condition_range', sql`${t.sailCondition} >= 0 AND ${t.sailCondition} <= 100`),
  check('elec_condition_range', sql`${t.elecCondition} >= 0 AND ${t.elecCondition} <= 100`),
]);

export const raceParticipants = pgTable('race_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: text('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  boatId: uuid('boat_id').notNull().references(() => boats.id, { onDelete: 'cascade' }),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  finalRank: integer('final_rank'),
  distanceNm: doublePrecision('distance_nm').notNull().default(0),
  currentLat: doublePrecision('current_lat'),
  currentLon: doublePrecision('current_lon'),
  currentHeading: real('current_heading'),
  currentBsp: real('current_bsp'),
}, (t) => [
  unique('uniq_boat_per_race').on(t.raceId, t.boatId),
  unique('uniq_player_boat_race').on(t.raceId, t.playerId, t.boatId),
]);

export const raceGates = pgTable('race_gates', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: text('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  orderIndex: smallint('order_index').notNull(),
  gateType: gateTypeEnum('gate_type').notNull(),
  point1Lat: doublePrecision('point1_lat').notNull(),
  point1Lon: doublePrecision('point1_lon').notNull(),
  point2Lat: doublePrecision('point2_lat'),
  point2Lon: doublePrecision('point2_lon'),
  passingSide: varchar('passing_side', { length: 10 }),
  hasLeaderboard: boolean('has_leaderboard').notNull().default(false),
  creditBonus: integer('credit_bonus').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gatePassages = pgTable('gate_passages', {
  id: uuid('id').primaryKey().defaultRandom(),
  gateId: uuid('gate_id').notNull().references(() => raceGates.id, { onDelete: 'cascade' }),
  participantId: uuid('participant_id').notNull().references(() => raceParticipants.id, { onDelete: 'cascade' }),
  passedAt: timestamp('passed_at', { withTimezone: true }).notNull(),
  rankAtGate: integer('rank_at_gate'),
  elapsedSeconds: integer('elapsed_seconds'),
}, (t) => [
  unique('uniq_gate_participant').on(t.gateId, t.participantId),
]);

export const exclusionZones = pgTable('exclusion_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: text('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: zoneTypeEnum('type').notNull(),
  geometry: jsonb('geometry').notNull(),
  speedMult: decimal('speed_mult', { precision: 4, scale: 3 }),
  reason: text('reason'),
  color: text('color'),
  activeFrom: timestamp('active_from', { withTimezone: true }),
  activeTo: timestamp('active_to', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const boatZoneAlerts = pgTable('boat_zone_alerts', {
  participantId: uuid('participant_id').notNull().references(() => raceParticipants.id, { onDelete: 'cascade' }),
  zoneId: uuid('zone_id').notNull().references(() => exclusionZones.id, { onDelete: 'cascade' }),
  enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
  exitedAt: timestamp('exited_at', { withTimezone: true }),
}, (t) => [
  unique('uniq_boat_zone_entry').on(t.participantId, t.zoneId, t.enteredAt),
]);

export const boatOrderQueue = pgTable('boat_order_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  participantId: uuid('participant_id').notNull().references(() => raceParticipants.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  orderType: orderTypeEnum('order_type').notNull(),
  value: jsonb('value').notNull(),
  triggerType: text('trigger_type').notNull(),
  triggerValue: jsonb('trigger_value'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('uniq_participant_position').on(t.participantId, t.position),
]);

export const playerUpgrades = pgTable('player_upgrades', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  upgradeCatalogId: text('upgrade_catalog_id').notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  acquisitionSource: upgradeAcquisitionSourceEnum('acquisition_source').notNull(),
  paidCredits: integer('paid_credits').notNull().default(0),
}, (t) => [
  index('idx_player_upgrades_player').on(t.playerId),
]);

export const boatInstalledUpgrades = pgTable('boat_installed_upgrades', {
  boatId: uuid('boat_id').notNull().references(() => boats.id, { onDelete: 'cascade' }),
  slot: upgradeSlotEnum('slot').notNull(),
  playerUpgradeId: uuid('player_upgrade_id').notNull().unique('uniq_player_upgrade_install')
    .references(() => playerUpgrades.id, { onDelete: 'cascade' }),
  installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.boatId, t.slot], name: 'pk_boat_installed_upgrades' }),
]);

export const boatTrackPoints = pgTable(
  'boat_track_points',
  {
    participantId: uuid('participant_id')
      .notNull()
      .references(() => raceParticipants.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.participantId, t.ts] }),
  }),
);
