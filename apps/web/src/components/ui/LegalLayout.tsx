'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');

  useEffect(() => {
    if (sections.length === 0) return;

    // On observe les <h2> des titres de section. Dès qu'un titre entre
    // dans la bande supérieure du viewport (120..45 %), il devient le
    // candidat actif ; parmi les visibles on garde celui dont le top
    // est le plus proche du haut.
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        if (visible.size > 0) {
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
        // Aucun titre dans la bande : soit on est au-dessus du 1er
        // (retour haut de page), soit entre le dernier titre et le bas
        // de page. On tranche en mesurant la position du 1er titre.
        const firstId = sections[0]?.id;
        const firstEl = firstId ? document.getElementById(firstId) : null;
        if (firstEl && firstEl.getBoundingClientRect().top > 0) {
          setActive(firstId!);
        } else {
          const lastId = sections[sections.length - 1]?.id;
          if (lastId) setActive(lastId);
        }
      },
      {
        // Bande d'activation : 120 px depuis le haut → 55 % depuis le bas.
        // Un titre devient actif quand il traverse cette zone.
        rootMargin: '-120px 0px -55% 0px',
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
          <span>Dernière mise à jour · {lastUpdated}</span>
          <span>Version 1.0</span>
        </p>
      </header>

      <div className={styles.layout}>
        <nav className={styles.sidenav} aria-label="Sections">
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
