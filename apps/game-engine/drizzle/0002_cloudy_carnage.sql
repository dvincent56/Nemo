CREATE TABLE IF NOT EXISTS "boat_track_points" (
	"participant_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "boat_track_points_participant_id_ts_pk" PRIMARY KEY("participant_id","ts")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boat_track_points" ADD CONSTRAINT "boat_track_points_participant_id_race_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."race_participants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "credits_non_negative" CHECK ("players"."credits" >= 0);