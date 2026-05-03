'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  CATEGORY_LABEL,
  formatNewsDate,
  type NewsItem,
} from '@/lib/home-data';
import styles from './NewsCard.module.css';

type LinkHref = Parameters<typeof Link>[0]['href'];

export interface NewsCardProps {
  /** Champs strictement nécessaires à la card. */
  news: Pick<
    NewsItem,
    'id' | 'slug' | 'category' | 'title' | 'excerpt' | 'imageUrl' | 'imageAlt' | 'publishedAt'
  >;
}

/**
 * Card éditoriale réutilisée par la home (Journal de bord),
 * le bloc "Lire aussi" d'un article, et l'index `/news`.
 *
 * Source de vérité unique pour le visuel — toute évolution se fait ici.
 */
export function NewsCard({ news }: NewsCardProps): React.ReactElement {
  const t = useTranslations('common.actions');
  return (
    <Link
      href={`/news/${news.slug}` as LinkHref}
      className={styles.card}
    >
      <div className={styles.image}>
        {news.imageUrl ? (
          <img
            src={news.imageUrl}
            alt={news.imageAlt ?? ''}
            aria-hidden={news.imageAlt ? undefined : true}
            loading="lazy"
          />
        ) : (
          <NewsFallbackSvg />
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.catChip}>{CATEGORY_LABEL[news.category]}</span>
          <span className={styles.date}>{formatNewsDate(news.publishedAt)}</span>
        </div>
        <h3 className={styles.title}>{news.title}</h3>
        <p className={styles.excerpt}>{news.excerpt}</p>
        <span className={styles.read}>{t('read')}</span>
      </div>
    </Link>
  );
}

function NewsFallbackSvg(): React.ReactElement {
  return (
    <div className={styles.fallback}>
      <svg viewBox="0 0 100 80" aria-hidden>
        <g stroke="#f5f0e8" fill="none" strokeWidth="0.6" opacity="0.6">
          <path d="M10,60 Q30,50 50,55 Q70,60 90,50" />
          <path d="M10,50 Q30,40 50,45 Q70,50 90,40" />
          <path d="M10,40 Q30,30 50,35 Q70,40 90,30" />
        </g>
        <g transform="translate(50, 40)">
          <path d="M-20,0 L20,0 L20,-3 L-20,-3 Z" fill="#c9a227" />
          <path
            d="M-20,-3 A25,25 0 0 1 20,-3"
            fill="none"
            stroke="#c9a227"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="0"
            x2="10"
            y2="-18"
            stroke="#c9a227"
            strokeWidth="1.5"
          />
          <circle cx="0" cy="0" r="2" fill="#c9a227" />
        </g>
      </svg>
    </div>
  );
}
