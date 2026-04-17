-- ============================================================================
-- BASELINE MIGRATION (généré par drizzle-kit avec un drizzle/ vide)
--
-- Ce fichier crée TOUT le schéma via CREATE TABLE IF NOT EXISTS.
-- Sur une DB déjà bootstrappée (par db:push notamment), les nouvelles
-- colonnes (ex. boats.generation) et la suppression de boats.total_upgrade_cost
-- ne s'appliqueront PAS via `db:migrate` — il faudrait un fichier ALTER
-- complémentaire ou repartir d'une DB vierge.
--
-- Phase 3 (état actuel projet) : workflow dev = db:push uniquement, pas de prod.
-- Quand on passera à db:migrate prod, prévoir un audit + une migration
-- corrective si besoin.
-- ============================================================================
CREATE TYPE "public"."boat_status" AS ENUM('ACTIVE', 'SOLD', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."gate_type" AS ENUM('GATE', 'MARK', 'FINISH');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('CAP', 'TWA', 'WPT', 'SAIL', 'MODE', 'VMG');--> statement-breakpoint
CREATE TYPE "public"."race_status" AS ENUM('DRAFT', 'PUBLISHED', 'BRIEFING', 'LIVE', 'FINISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('FREE', 'CAREER');--> statement-breakpoint
CREATE TYPE "public"."upgrade_acquisition_source" AS ENUM('PURCHASE', 'ACHIEVEMENT_UNLOCK', 'BOAT_SOLD_RETURN', 'ADMIN_GRANT', 'GIFT', 'MIGRATION');--> statement-breakpoint
CREATE TYPE "public"."upgrade_slot" AS ENUM('HULL', 'MAST', 'SAILS', 'FOILS', 'KEEL', 'ELECTRONICS', 'REINFORCEMENT');--> statement-breakpoint
CREATE TYPE "public"."zone_type" AS ENUM('WARN', 'PENALTY');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boat_installed_upgrades" (
	"boat_id" uuid NOT NULL,
	"slot" "upgrade_slot" NOT NULL,
	"player_upgrade_id" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boat_installed_upgrades_player_upgrade_id_unique" UNIQUE("player_upgrade_id"),
	CONSTRAINT "uniq_boat_slot" UNIQUE("boat_id","slot")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boat_order_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"order_type" "order_type" NOT NULL,
	"value" jsonb NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_value" jsonb,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_participant_position" UNIQUE("participant_id","position")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boat_zone_alerts" (
	"participant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	CONSTRAINT "uniq_boat_zone_entry" UNIQUE("participant_id","zone_id","entered_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "boats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"boat_class" varchar(20) NOT NULL,
	"hull_color" varchar(7),
	"hull_texture_url" text,
	"sail_texture_url" text,
	"generation" smallint DEFAULT 1 NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"active_race_id" text,
	"hull_condition" smallint DEFAULT 100 NOT NULL,
	"rig_condition" smallint DEFAULT 100 NOT NULL,
	"sail_condition" smallint DEFAULT 100 NOT NULL,
	"elec_condition" smallint DEFAULT 100 NOT NULL,
	"races_count" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"podiums" integer DEFAULT 0 NOT NULL,
	"top10_finishes" integer DEFAULT 0 NOT NULL,
	"notable_races" text[],
	"status" "boat_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hull_condition_range" CHECK ("boats"."hull_condition" >= 0 AND "boats"."hull_condition" <= 100),
	CONSTRAINT "rig_condition_range" CHECK ("boats"."rig_condition" >= 0 AND "boats"."rig_condition" <= 100),
	CONSTRAINT "sail_condition_range" CHECK ("boats"."sail_condition" >= 0 AND "boats"."sail_condition" <= 100),
	CONSTRAINT "elec_condition_range" CHECK ("boats"."elec_condition" >= 0 AND "boats"."elec_condition" <= 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exclusion_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "zone_type" NOT NULL,
	"geometry" jsonb NOT NULL,
	"speed_mult" numeric(4, 3),
	"reason" text,
	"color" text,
	"active_from" timestamp with time zone,
	"active_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gate_passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gate_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"passed_at" timestamp with time zone NOT NULL,
	"rank_at_gate" integer,
	"elapsed_seconds" integer,
	CONSTRAINT "uniq_gate_participant" UNIQUE("gate_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_upgrades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"upgrade_catalog_id" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acquisition_source" "upgrade_acquisition_source" NOT NULL,
	"paid_credits" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cognito_sub" varchar(128) NOT NULL,
	"username" varchar(40) NOT NULL,
	"email" varchar(255) NOT NULL,
	"tier" "tier" DEFAULT 'FREE' NOT NULL,
	"stripe_customer_id" varchar(64),
	"credits" integer DEFAULT 500 NOT NULL,
	"ranking_score" integer DEFAULT 0 NOT NULL,
	"races_finished" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"podiums" integer DEFAULT 0 NOT NULL,
	"top10_finishes" integer DEFAULT 0 NOT NULL,
	"avg_rank_pct" real DEFAULT 0 NOT NULL,
	"total_nm" real DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_cognito_sub_unique" UNIQUE("cognito_sub"),
	CONSTRAINT "players_username_unique" UNIQUE("username"),
	CONSTRAINT "players_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "race_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"order_index" smallint NOT NULL,
	"gate_type" "gate_type" NOT NULL,
	"point1_lat" double precision NOT NULL,
	"point1_lon" double precision NOT NULL,
	"point2_lat" double precision,
	"point2_lon" double precision,
	"passing_side" varchar(10),
	"has_leaderboard" boolean DEFAULT false NOT NULL,
	"credit_bonus" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "race_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" text NOT NULL,
	"player_id" uuid NOT NULL,
	"boat_id" uuid NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"final_rank" integer,
	"distance_nm" double precision DEFAULT 0 NOT NULL,
	"current_lat" double precision,
	"current_lon" double precision,
	"current_heading" real,
	"current_bsp" real,
	CONSTRAINT "uniq_boat_per_race" UNIQUE("race_id","boat_id"),
	CONSTRAINT "uniq_player_boat_race" UNIQUE("race_id","player_id","boat_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "races" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"cover_image_url" text,
	"status" "race_status" DEFAULT 'DRAFT' NOT NULL,
	"boat_class" varchar(20) NOT NULL,
	"tier_required" "tier" DEFAULT 'FREE' NOT NULL,
	"course_geojson" jsonb NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"starts_at" timestamp with time zone NOT NULL,
	"estimated_duration_hours" integer,
	"max_participants" integer,
	"rewards_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boat_installed_upgrades" ADD CONSTRAINT "boat_installed_upgrades_boat_id_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."boats"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boat_installed_upgrades" ADD CONSTRAINT "boat_installed_upgrades_player_upgrade_id_player_upgrades_id_fk" FOREIGN KEY ("player_upgrade_id") REFERENCES "public"."player_upgrades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boat_order_queue" ADD CONSTRAINT "boat_order_queue_participant_id_race_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."race_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boat_zone_alerts" ADD CONSTRAINT "boat_zone_alerts_participant_id_race_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."race_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boat_zone_alerts" ADD CONSTRAINT "boat_zone_alerts_zone_id_exclusion_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."exclusion_zones"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boats" ADD CONSTRAINT "boats_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boats" ADD CONSTRAINT "boats_active_race_id_races_id_fk" FOREIGN KEY ("active_race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exclusion_zones" ADD CONSTRAINT "exclusion_zones_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_passages" ADD CONSTRAINT "gate_passages_gate_id_race_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."race_gates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_passages" ADD CONSTRAINT "gate_passages_participant_id_race_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."race_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_upgrades" ADD CONSTRAINT "player_upgrades_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "race_gates" ADD CONSTRAINT "race_gates_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "race_participants" ADD CONSTRAINT "race_participants_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "race_participants" ADD CONSTRAINT "race_participants_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "race_participants" ADD CONSTRAINT "race_participants_boat_id_boats_id_fk" FOREIGN KEY ("boat_id") REFERENCES "public"."boats"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_upgrades_player" ON "player_upgrades" USING btree ("player_id");