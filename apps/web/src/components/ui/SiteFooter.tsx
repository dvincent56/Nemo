import Link from 'next/link';
import styles from './SiteFooter.module.css';

type Href = Parameters<typeof Link>[0]['href'];

interface FooterLink {
  label: string;
  href: Href;
}

const PRODUIT_LINKS: FooterLink[] = [
  { label: 'Courses', href: '/races' },
  { label: 'Classement', href: '/ranking' },
  { label: 'Marina', href: '/marina' },
  { label: 'Mode carrière', href: '/subscribe' as Href },
  { label: 'Mode spectateur', href: '/races' },
];

// Casts en Href nécessaires tant que Next.js n'a pas régénéré `.next/types`
// après ajout des 4 routes. Disparaîtront au prochain `pnpm dev`.
const LEGAL_LINKS: FooterLink[] = [
  { label: 'CGU', href: '/cgu' as Href },
  { label: 'Confidentialité', href: '/privacy' as Href },
  { label: 'Mentions légales', href: '/legal' as Href },
  { label: 'Cookies', href: '/cookies' as Href },
];

export function SiteFooter(): React.ReactElement {
  return (
    <footer className={styles.foot}>
      <div className={styles.inner}>
        <div className={styles.col}>
          <h5>Produit</h5>
          <ul>
            {PRODUIT_LINKS.map((l) => (
              <li key={l.label}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.col}>
          <h5>Légal</h5>
          <ul>
            {LEGAL_LINKS.map((l) => (
              <li key={l.label}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.col}>
          <h5>Contact</h5>
          <ul>
            <li>
              <a href="mailto:hello@nemo.sail">hello@nemo.sail</a>
            </li>
          </ul>
        </div>
      </div>
      <div className={styles.bottom}>
        <Link href="/" className={styles.brand} aria-label="Nemo">
          NE<span>M</span>O
        </Link>
        <p className={styles.copy}>© 2026 Nemo · Hébergé en Europe</p>
      </div>
    </footer>
  );
}
