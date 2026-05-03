'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Eyebrow } from './Eyebrow';
import styles from './LegalLayout.module.css';

export interface LegalSection {
  /** Ancre (URL #id) + clé stable. */
  id: string;
  /** Numéro affiché (ex: "01"). */
  num: string;
  /** Titre de la section dans le sidenav et la page. */
  title: string;
  /** Contenu JSX (paragraphes, listes, tableaux…). */
  body: ReactNode;
}

export interface LegalLayoutProps {
  eyebrow: string;
  trailing?: string;
  title: string;
  /** Paragraphe d'intro sous le titre. */
  intro?: ReactNode;
  /** Dernière mise à jour — format libre, ex. "16 avril 2026". */
  lastUpdated: string;
  sections: LegalSection[];
}

/**
 * Gabarit partagé pour /cgu, /privacy, /legal, /cookies.
 * Hero + sidenav sticky + colonne de sections numérotées.
 * Scroll-spy : active le lien du sidenav correspondant à la section visible.
 */
export function LegalLayout({
  eyebrow, trailing, title, intro, lastUpdated, sections,
}: LegalLayoutProps): React.ReactElement {
  const t = useTranslations('common');
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');

  useEffect(() => {
    if (sections.length === 0) return;

    // On observe les <h2> via IntersectionObserver : c'est le seul mécanisme
    // qui marche indépendamment du modèle de scroll (window vs body — le CSS
    // global force `html, body { height: 100% }` ce qui rend les scroll
    // listeners sur window peu fiables).
    //
    // Bande d'activation = 120px (ligne haute) → 45% (ligne basse) du viewport.
    // - h2 dans la bande     → candidat actif (cas nominal)
    // - aucun h2 dans la bande → on est entre deux titres, l'actif est le
    //   dernier titre passé au-dessus de la ligne haute.
    const ACTIVATION_TOP_PX = 120;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        if (visible.size > 0) {
          // Parmi les h2 dans la bande, on garde celui dont le top est le
          // plus proche du haut (= le titre "courant" qu'on lit).
          let bestId: string | null = null;
          let bestTop = Infinity;
          visible.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const top = el.getBoundingClientRect().top;
            if (top < bestTop) { bestTop = top; bestId = id; }
          });
          if (bestId !== null) setActive(bestId);
          return;
        }
        // Aucun h2 dans la bande : trouver le dernier h2 dont le top est
        // au-dessus de la ligne haute. C'est la section dont on lit le
        // corps (entre son titre et le titre suivant).
        let lastPassedId: string | null = null;
        for (const s of sections) {
          const el = document.getElementById(s.id);
          if (!el) continue;
          if (el.getBoundingClientRect().top <= ACTIVATION_TOP_PX) {
            lastPassedId = s.id;
          }
        }
        setActive(lastPassedId ?? sections[0]!.id);
      },
      {
        rootMargin: `-${ACTIVATION_TOP_PX}px 0px -55% 0px`,
        threshold: 0,
      },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections]);

  return (
    <>
      <header className={styles.hero}>
        <Eyebrow trailing={trailing}>{eyebrow}</Eyebrow>
        <h1 className={styles.title}>{title}</h1>
        {intro && <p className={styles.intro}>{intro}</p>}
        <p className={styles.meta}>
          <span>{t('legal.lastUpdated', { date: lastUpdated })}</span>
          <span>{t('legal.version')}</span>
        </p>
      </header>

      <div className={styles.layout}>
        <nav className={styles.sidenav} aria-label={t('aria.sections')}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`${styles.sidenavLink} ${active === s.id ? styles.active : ''}`}
            >
              <span>{s.title}</span>
              <span className={styles.sidenavNum}>{s.num}</span>
            </a>
          ))}
        </nav>

        <div className={styles.sections}>
          {sections.map((s) => (
            <section key={s.id} className={styles.section}>
              <span className={styles.sectionNum}>{s.num}</span>
              <div className={styles.sectionBody}>
                <h2 id={s.id} className={styles.sectionTitle}>{s.title}</h2>
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
