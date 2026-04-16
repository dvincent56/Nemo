ALTER TABLE "boat_installed_upgrades" DROP CONSTRAINT "boat_installed_upgrades_player_upgrade_id_unique";--> statement-breakpoint
ALTER TABLE "boat_installed_upgrades" DROP CONSTRAINT "uniq_boat_slot";--> statement-breakpoint
ALTER TABLE "boat_installed_upgrades" ADD CONSTRAINT "pk_boat_installed_upgrades" PRIMARY KEY("boat_id","slot");--> statement-breakpoint
ALTER TABLE "boat_installed_upgrades" ADD CONSTRAINT "uniq_player_upgrade_install" UNIQUE("player_upgrade_id");