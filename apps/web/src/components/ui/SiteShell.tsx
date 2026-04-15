import type { ReactNode } from 'react';
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
 */
export function SiteShell({
  children,
  navLinks,
  hideFooter = false,
  hideTopbar = false,
}: SiteShellProps): React.ReactElement {
  return (
    <div className={styles.shell}>
      {!hideTopbar && <Topbar {...(navLinks ? { links: navLinks } : {})} />}
      <main className={styles.main}>{children}</main>
      {!hideFooter && <SiteFooter />}
    </div>
  );
}
