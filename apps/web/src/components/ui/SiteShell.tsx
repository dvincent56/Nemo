import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { parseDevToken } from '@/lib/access';
import { Topbar, type TopbarLink } from './Topbar';
import { SiteFooter } from './SiteFooter';
import styles from './SiteShell.module.css';

export interface SiteShellProps {
  children: ReactNode;
  /** Surcharge les liens du topbar selon le rôle / contexte. */
  navLinks?: TopbarLink[];
  /** Cache le footer (ex. écran /play fullscreen). */
  hideFooter?: boolean;
  /** Cache le topbar (ex. /play qui a son propre HUD). */
  hideTopbar?: boolean;
}

/**
 * Shell commun à toutes les pages non-jeu :
 *   <Topbar (brand + nav + burger + lang) /> <main>{children}</main> <SiteFooter />
 *
 * Pages qui NE l'utilisent PAS :
 *   - /login (topbar minimaliste propre à elle)
 *   - /play/:raceId (fullscreen — HUD sert de header)
 *
 * Lit le cookie `nemo_access_token` côté serveur pour déterminer si on est
 * en mode visiteur (non authentifié). En visiteur, Marina et Profil sont
 * masqués du menu et remplacés par un CTA "Se connecter".
 */
export async function SiteShell({
  children,
  navLinks,
  hideFooter = false,
  hideTopbar = false,
}: SiteShellProps): Promise<React.ReactElement> {
  const cookieStore = await cookies();
  const token = cookieStore.get('nemo_access_token')?.value ?? null;
  const session = parseDevToken(token);
  const isVisitor = session.role === 'VISITOR';

  return (
    <div className={styles.shell}>
      {!hideTopbar && <Topbar isVisitor={isVisitor} {...(navLinks ? { links: navLinks } : {})} />}
      <main className={styles.main}>{children}</main>
      {!hideFooter && <SiteFooter />}
    </div>
  );
}
