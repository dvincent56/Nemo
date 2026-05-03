'use client';

import { useTranslations } from 'next-intl';
import styles from './Pagination.module.css';

export interface PaginationProps {
  page: number;        // 1-indexed
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  onChange: (page: number) => void;
  /** Affiche un compteur "X–Y / Z" à gauche. */
  showMeta?: boolean;
  /** Étiquette pour l'aria-label. */
  label?: string;
}

/**
 * Génère la séquence de boutons pour la pagination — toujours :
 *   ← [1] [2] … [N] →
 * avec ellipsis quand totalPages > 7. La page active est centrée si possible.
 */
function buildPages(current: number, total: number): (number | 'sep')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | 'sep')[] = [1];
  if (current > 3) pages.push('sep');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let p = start; p <= end; p++) pages.push(p);
  if (current < total - 2) pages.push('sep');
  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onChange,
  showMeta = true,
  label,
}: PaginationProps): React.ReactElement | null {
  const t = useTranslations('common');
  if (totalPages <= 1) return null;
  const buttons = buildPages(page, totalPages);
  const navLabel = label ?? t('pagination.label');

  const metaText = (() => {
    if (!showMeta || !totalItems || !pageSize) return null;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(totalItems, page * pageSize);
    return `${start}–${end} / ${totalItems}`;
  })();

  return (
    <nav className={styles.pagination} aria-label={navLabel}>
      {metaText && <span className={styles.meta}>{metaText}</span>}
      <button
        type="button"
        className={styles.btn}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label={t('aria.prevPage')}
      >←</button>
      {buttons.map((b, i) => (
        b === 'sep'
          ? <span key={`sep-${i}`} className={`${styles.btn} ${styles.sep}`}>…</span>
          : (
            <button
              key={b}
              type="button"
              className={`${styles.btn} ${b === page ? styles.active : ''}`}
              onClick={() => onChange(b)}
              aria-current={b === page ? 'page' : undefined}
              aria-label={t('pagination.page', { n: b })}
            >{b}</button>
          )
      ))}
      <button
        type="button"
        className={styles.btn}
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label={t('aria.nextPage')}
      >→</button>
    </nav>
  );
}
