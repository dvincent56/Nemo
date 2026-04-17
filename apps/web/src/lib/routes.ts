/**
 * Constructeurs d'URL typés pour les routes du site.
 *
 * Règle d'or : quand une ligne représente le joueur courant (`isMe`), on
 * route vers `/profile` (canonique "ma page") plutôt que `/profile/<pseudo>`.
 * Évite d'exposer le username dans l'URL quand l'utilisateur consulte sa
 * propre fiche et garantit une adresse stable pour ses bookmarks.
 */

export function profileHref(username: string, isMe: boolean | undefined): string {
  if (isMe) return '/profile';
  return `/profile/${encodeURIComponent(username)}`;
}
