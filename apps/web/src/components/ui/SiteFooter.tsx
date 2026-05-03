import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageSelector } from './LanguageSelector';
import styles from './SiteFooter.module.css';

type Href = Parameters<typeof Link>[0]['href'];

interface FooterLink {
  label: string;
  href: Href;
}

export async function SiteFooter(): Promise<React.ReactElement> {
  const t = await getTranslations('common');

  const produitLinks: FooterLink[] = [
    { label: t('nav.courses'), href: '/races' },
    { label: t('nav.ranking'), href: '/ranking' },
    { label: t('nav.marina'), href: '/marina' },
    { label: t('nav.careerMode'), href: '/subscribe' as Href },
    { label: t('nav.spectatorMode'), href: '/races' },
  ];

  const legalLinks: FooterLink[] = [
    { label: t('legal.cgu'), href: '/cgu' as Href },
    { label: t('legal.privacy'), href: '/privacy' as Href },
    { label: t('legal.mentions'), href: '/legal' as Href },
    { label: t('legal.cookies'), href: '/cookies' as Href },
  ];

  return (
    <footer className={styles.foot}>
      <div className={styles.inner}>
        <div className={styles.col}>
          <h5>{t('footer.product')}</h5>
          <ul>
            {produitLinks.map((l) => (
              <li key={l.label}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.col}>
          <h5>{t('footer.legal')}</h5>
          <ul>
            {legalLinks.map((l) => (
              <li key={l.label}>
                <Link href={l.href}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.col}>
          <h5>{t('footer.contact')}</h5>
          <ul>
            <li>
              <a href="mailto:hello@nemo.sail">hello@nemo.sail</a>
            </li>
          </ul>
        </div>
      </div>
      <div className={styles.bottom}>
        <Link href="/" className={styles.brand} aria-label={t('aria.brandNemo')}>
          NE<span>M</span>O
        </Link>
        <LanguageSelector />
        <p className={styles.copy}>{t('footer.copy')}</p>
      </div>
    </footer>
  );
}
