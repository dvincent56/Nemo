import { redirect } from 'next/navigation';

/**
 * Racine `/` — provisoire, redirige vers `/races`.
 *
 * TODO Phase 4/5 : remplacer par une vraie landing marketing (présentation
 * du jeu, comparatif vs Virtual Regatta, CTA inscription + connexion, footer
 * complet) distincte de la liste de courses authentifiée.
 */
export default function RootRedirect(): never {
  redirect('/races');
}
