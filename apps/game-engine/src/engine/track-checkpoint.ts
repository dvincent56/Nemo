/**
 * Décide si un checkpoint trace doit être écrit pour ce participant à `nowMs`.
 * - `lastCheckpointTs` null ⇒ pas encore de checkpoint, on en force un.
 * - sinon ⇒ on attend que `intervalMs` se soit écoulé depuis le dernier.
 */
export function shouldCheckpoint(
  lastCheckpointTs: number | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (lastCheckpointTs === null) return true;
  return nowMs - lastCheckpointTs >= intervalMs;
}

export interface CheckpointInput {
  participantId: string;
  lat: number;
  lon: number;
  lastCheckpointTs: number | null;
}

export interface CheckpointRow {
  participantId: string;
  tsMs: number;
  lat: number;
  lon: number;
  rank: number;
}

/**
 * Construit la liste des checkpoints à insérer ce tick.
 * Un participant est inclus si :
 *  - son intervalle est écoulé (ou jamais checkpointé), OU
 *  - son id est dans `forceFor` (ex. première tick de la course, finish, DNF).
 *
 * Les participants dont le rang est inconnu (`ranks` n'a pas leur clé) sont
 * silencieusement skip — caller responsibility de fournir un rank pour chaque
 * participant qu'il veut tracer.
 */
export function enqueueCheckpoints(
  inputs: readonly CheckpointInput[],
  ranks: ReadonlyMap<string, number>,
  nowMs: number,
  intervalMs: number,
  forceFor: ReadonlySet<string> = new Set(),
): CheckpointRow[] {
  const out: CheckpointRow[] = [];
  for (const input of inputs) {
    const force = forceFor.has(input.participantId);
    if (!force && !shouldCheckpoint(input.lastCheckpointTs, nowMs, intervalMs)) continue;
    const rank = ranks.get(input.participantId);
    if (rank === undefined) continue;
    out.push({
      participantId: input.participantId,
      tsMs: nowMs,
      lat: input.lat,
      lon: input.lon,
      rank,
    });
  }
  return out;
}
