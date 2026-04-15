'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Eyebrow, Field } from '@/components/ui';
import { API_BASE } from '@/lib/api';
import styles from './page.module.css';

const LANGS = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
  { code: 'de', label: 'DE' },
];

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/dev-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: username.trim() || 'dev' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.push('/races');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className={styles.topbar}>
        <span className={styles.brand}>NE<span>M</span>O</span>
        <nav className={styles.lang} aria-label="Langue">
          {LANGS.map((l) => (
            <a
              key={l.code}
              href="#"
              className={l.code === 'fr' ? styles.active : ''}
            >
              {l.label}
            </a>
          ))}
        </nav>
      </header>

      <main className={styles.shell}>
        <section className={styles.editorial}>
          <div>
            <Eyebrow trailing="Saison 2026">01 · Accès skipper</Eyebrow>
            <h1 className={styles.headline}>
              Bienvenue<br />à <em>bord</em>.
            </h1>
            <p className={styles.lede}>
              <strong>Nemo</strong> est un circuit de course offshore en ligne.
              Polaires certifiées par les constructeurs, météo NOAA vérifiable,
              et une règle que personne ne franchira jamais&nbsp;: zéro pay-to-win.
            </p>
          </div>

          <div className={styles.manifesto}>
            {[
              { n: '01', t: 'Polaires réelles', d: 'Les mêmes fichiers pour tous les joueurs, du Figaro III à l\'Ultim.' },
              { n: '02', t: 'Météo NOAA GFS', d: 'Mise à jour toutes les 6 h, identique côté moteur et routeur.' },
              { n: '03', t: 'Jamais pay-to-win', d: 'Les crédits ne s\'achètent pas. Les upgrades s\'obtiennent en courant.' },
            ].map((m) => (
              <div key={m.n} className={styles.manifestoItem}>
                <span className={styles.manifestoNum}>{m.n}</span>
                <p className={styles.manifestoBody}>
                  <strong>{m.t}</strong>
                  {m.d}
                </p>
              </div>
            ))}
          </div>

          <p className={styles.colophon}>Un skipper libre vaut mieux qu'un abonné résigné</p>

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
              <h2 className={styles.formTitle}>Connexion</h2>
              <p className={styles.formSub}>
                Accédez au circuit avec votre email ou un provider OAuth.
              </p>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <form onSubmit={submit} noValidate className={styles.form}>
              <Field
                label="Nom de skipper"
                hint="dev mode"
                placeholder="DarkRiguidel"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
              <Button type="submit" variant="primary" icon fullWidth disabled={loading}>
                {loading ? 'Connexion' : 'Larguer les amarres'}
              </Button>
            </form>

            <div className={styles.divider}>
              <span className={styles.dividerLabel}>ou · OAuth Phase 4</span>
            </div>

            <div className={styles.oauth}>
              <button type="button" className={styles.oauthBtn} disabled>
                <span className={styles.oauthIcon}>G</span>
                <span>Continuer avec Google</span>
                <span className={styles.oauthTag}>Phase 4</span>
              </button>
              <button type="button" className={styles.oauthBtn} disabled>
                <span className={styles.oauthIcon}>⌘</span>
                <span>Continuer avec Apple</span>
                <span className={styles.oauthTag}>Phase 5</span>
              </button>
            </div>

            <p className={styles.legal}>
              En continuant, vous acceptez nos <a href="#">Conditions d'utilisation</a>{' '}
              et notre <a href="#">Politique de confidentialité</a>. Les données
              de compte sont hébergées en Europe (AWS Cognito · eu-west-3).
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
