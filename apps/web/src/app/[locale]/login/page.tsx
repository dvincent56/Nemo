'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import { Button, Eyebrow, Field, LanguageSelector } from '@/components/ui';
import { API_BASE } from '@/lib/api';
import styles from './page.module.css';

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('login');
  const tForm = useTranslations('login.form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function devLogin(username: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/dev-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push('/marina');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    // The backend dev-login parses the token as "dev.<sub>.<username>",
    // so any dot in the username (e.g. an email) breaks verification.
    // Strip domain if the user typed an email.
    const username = email.trim().split('@')[0] || 'dev';
    await devLogin(username);
  }

  const manifestoItems = [
    { n: '01', t: t('manifesto.1.title'), d: t('manifesto.1.body') },
    { n: '02', t: t('manifesto.2.title'), d: t('manifesto.2.body') },
    { n: '03', t: t('manifesto.3.title'), d: t('manifesto.3.body') },
    { n: '04', t: t('manifesto.4.title'), d: t('manifesto.4.body') },
  ];

  return (
    <>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label={t('aria.brandHome')}>
          NE<span>M</span>O
        </Link>
        <div className={styles.lang}>
          <LanguageSelector />
        </div>
      </header>

      <main className={styles.shell}>
        <section className={styles.editorial}>
          <div>
            <Eyebrow trailing={t('eyebrowSeason')}>{t('eyebrowAccess')}</Eyebrow>
            <h1 className={styles.headline}>
              {t('headline.line1')}<br />{t('headline.line2Pre')}<em>{t('headline.line2Em')}</em>{t('headline.line2Post')}
            </h1>
            <p className={styles.lede}>
              {t.rich('lede', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>

          <div className={styles.manifesto}>
            {manifestoItems.map((m) => (
              <div key={m.n} className={styles.manifestoItem}>
                <span className={styles.manifestoNum}>{m.n}</span>
                <p className={styles.manifestoBody}>
                  <strong>{m.t}</strong>
                  {m.d}
                </p>
              </div>
            ))}
          </div>

          <p className={styles.colophon}>{t('colophon')}</p>

          <div className={styles.compassBg} aria-hidden>
            <svg viewBox="0 0 340 340">
              <g fill="none" stroke="#1a2840" strokeWidth="1">
                <circle cx="170" cy="170" r="160" />
                <circle cx="170" cy="170" r="130" />
                <circle cx="170" cy="170" r="90" />
                <circle cx="170" cy="170" r="30" />
                <line x1="170" y1="10" x2="170" y2="330" />
                <line x1="10" y1="170" x2="330" y2="170" />
                <line x1="56" y1="56" x2="284" y2="284" />
                <line x1="284" y1="56" x2="56" y2="284" />
              </g>
              <path d="M170,10 L180,160 L170,170 L160,160 Z" fill="#c9a227" />
            </svg>
          </div>
        </section>

        <section className={styles.formPane}>
          <div className={styles.formInner}>
            <div className={styles.formHead}>
              <h2 className={styles.formTitle}>{tForm('title')}</h2>
              <p className={styles.formSub}>{tForm('sub')}</p>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <form onSubmit={submit} noValidate className={styles.form}>
              <Field
                label={tForm('emailLabel')}
                type="email"
                autoComplete="email"
                placeholder={tForm('emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Field
                label={tForm('passwordLabel')}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                action={
                  <Link href={'/reset-password' as Route} className={styles.labelAction}>
                    {tForm('forgotPassword')}
                  </Link>
                }
              />
              <Button type="submit" variant="primary" icon fullWidth disabled={loading}>
                {loading ? tForm('submitLoading') : tForm('submitIdle')}
              </Button>
            </form>

            <p className={styles.signup}>
              {tForm('noAccountQuestion')}{' '}
              <Link href={'/register' as Route} className={styles.signupLink}>{tForm('signupLink')}</Link>
            </p>

            <div className={styles.divider}>
              <span className={styles.dividerLabel}>{tForm('dividerDev')}</span>
            </div>

            <Button
              type="button"
              variant="secondary"
              fullWidth
              disabled={loading}
              onClick={() => devLogin('dev')}
            >
              {tForm('devButton')}
            </Button>

            <div className={styles.divider}>
              <span className={styles.dividerLabel}>{tForm('dividerOauth')}</span>
            </div>

            <div className={styles.oauth}>
              <button type="button" className={styles.oauthBtn} disabled>
                <span className={styles.oauthIcon}>G</span>
                <span>{tForm('oauthGoogle')}</span>
                <span className={styles.oauthTag}>{tForm('phase4Tag')}</span>
              </button>
              <button type="button" className={styles.oauthBtn} disabled>
                <span className={styles.oauthIcon}>⌘</span>
                <span>{tForm('oauthApple')}</span>
                <span className={styles.oauthTag}>{tForm('phase5Tag')}</span>
              </button>
            </div>

            <p className={styles.legal}>
              {tForm('legalPre')}<a href="#">{tForm('legalCgu')}</a>{tForm('legalAnd')}<a href="#">{tForm('legalPrivacy')}</a>{tForm('legalPost')}
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
