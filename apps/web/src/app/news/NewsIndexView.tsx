import { Eyebrow, NewsCard } from '@/components/ui';
import type { NewsItem } from '@/app/home-data';
import styles from './page.module.css';

export default function NewsIndexView({
  news,
}: {
  news: NewsItem[];
}): React.ReactElement {
  const sorted = [...news].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );

  return (
    <>
      <header className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing="Saison 2026 · Circuit Nemo">01 · Actualités</Eyebrow>
          <h1 className={styles.title}>Journal de bord</h1>
        </div>
        <p className={styles.heroLede}>
          Annonces de courses, ajustements de balance, interviews de skippers,
          nouveautés du jeu. Mis à jour par la rédaction Nemo.
        </p>
      </header>

      <section className={styles.list} aria-label="Liste des actualités">
        {sorted.length === 0 ? (
          <p className={styles.empty}>Aucune actualité pour le moment.</p>
        ) : (
          <div className={styles.grid}>
            {sorted.map((n) => (
              <NewsCard key={n.id} news={n} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
