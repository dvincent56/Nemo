import { sql } from 'drizzle-orm';
import { boatTrackPoints } from '../db/schema.js';
import type { DbClient } from '../db/client.js';

/**
 * Supprime tous les track points associés aux participants d'une course.
 * Appelé lorsque la course passe en statut ARCHIVED. Idempotent.
 *
 * Le `ON DELETE CASCADE` du schéma couvre déjà le cas où l'on supprime aussi
 * les `race_participants` ; cette fonction permet de purger sans toucher
 * aux participants (cas courant : on archive la course mais on garde les
 * statistiques de classement final).
 */
export async function cleanupRaceTrackPoints(
  db: DbClient,
  raceId: string,
): Promise<void> {
  await db
    .delete(boatTrackPoints)
    .where(sql`participant_id IN (SELECT id FROM race_participants WHERE race_id = ${raceId})`);
}
