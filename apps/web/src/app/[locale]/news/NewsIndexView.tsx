import { getTranslations } from 'next-intl/server';
import { Eyebrow, NewsCard } from '@/components/ui';
import type { NewsItem } from '@/lib/home-data';
import styles from './page.module.css';

export default async function NewsIndexView({
  news,
}: {
  news: NewsItem[];
}): Promise<React.ReactElement> {
  const t = await getTranslations('news');
  const sorted = [...news].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );

  return (
    <>
      <header className={styles.hero}>
        <div className={styles.heroMain}>
          <Eyebrow trailing={t('indexEyebrowTrailing')}>{t('indexEyebrowNum')}</Eyebrow>
          <h1 className={styles.title}>{t('indexTitle')}</h1>
        </div>
        <p className={styles.heroLede}>{t('indexLede')}</p>
      </header>

      <section className={styles.list} aria-label={t('indexAriaList')}>
        {sorted.length === 0 ? (
          <p className={styles.empty}>{t('indexEmpty')}</p>
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
