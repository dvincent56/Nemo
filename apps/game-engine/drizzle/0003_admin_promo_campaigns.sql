CREATE TYPE "public"."campaign_audience" AS ENUM('SUBSCRIBERS', 'NEW_SIGNUPS');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('CREDITS', 'UPGRADE', 'TRIAL');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('GIFT_AVAILABLE', 'TRIAL_GRANTED', 'TEAM_INVITE', 'FRIEND_REQUEST', 'RACE_REMINDER');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action_type" varchar(64) NOT NULL,
	"target_type" varchar(32),
	"target_id" varchar(64),
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_claim_per_player" UNIQUE("campaign_id","player_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "campaign_type" NOT NULL,
	"credits_amount" integer,
	"upgrade_catalog_id" text,
	"trial_days" integer,
	"audience" "campaign_audience" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"linked_race_id" text,
	"message_title" varchar(100) NOT NULL,
	"message_body" varchar(500) NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "campaigns_payload_chk" CHECK (
    ("campaigns"."type" = 'CREDITS' AND "campaigns"."credits_amount" IS NOT NULL AND "campaigns"."upgrade_catalog_id" IS NULL AND "campaigns"."trial_days" IS NULL) OR
    ("campaigns"."type" = 'UPGRADE' AND "campaigns"."upgrade_catalog_id" IS NOT NULL AND "campaigns"."credits_amount" IS NULL AND "campaigns"."trial_days" IS NULL) OR
    ("campaigns"."type" = 'TRIAL'   AND "campaigns"."trial_days" IS NOT NULL AND "campaigns"."credits_amount" IS NULL AND "campaigns"."upgrade_catalog_id" IS NULL)
  ),
	CONSTRAINT "campaigns_audience_chk" CHECK (
    ("campaigns"."type" = 'TRIAL' AND "campaigns"."audience" = 'NEW_SIGNUPS') OR
    ("campaigns"."type" IN ('CREDITS', 'UPGRADE') AND "campaigns"."audience" = 'SUBSCRIBERS')
  ),
	CONSTRAINT "campaigns_credits_positive" CHECK ("campaigns"."credits_amount" IS NULL OR "campaigns"."credits_amount" > 0),
	CONSTRAINT "campaigns_trial_days_positive" CHECK ("campaigns"."trial_days" IS NULL OR "campaigns"."trial_days" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "trial_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_id_players_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_claims" ADD CONSTRAINT "campaign_claims_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_claims" ADD CONSTRAINT "campaign_claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_linked_race_id_races_id_fk" FOREIGN KEY ("linked_race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_admin_id_players_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."players"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notifications" ADD CONSTRAINT "notifications_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_actions_admin_created" ON "admin_actions" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_actions_type_created" ON "admin_actions" USING btree ("action_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_campaign_claims_player" ON "campaign_claims" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_player_unread" ON "notifications" USING btree ("player_id","read_at","created_at");