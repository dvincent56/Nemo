import Link from 'next/link';
import { NewsCard } from '@/components/ui';
import {
  CATEGORY_LABEL,
  formatNewsDate,
  type NewsBlock,
  type NewsItem,
} from '@/app/home-data';
import styles from './page.module.css';

type LinkHref = Parameters<typeof Link>[0]['href'];

/**
 * Mini-parser inline : convertit `**bold**`, `*italic*`, `[text](url)`
 * en React nodes. Sûr (pas de dangerouslySetInnerHTML), idempotent.
 *
 * Ordre de priorité : bold > italic > link. Pas de support imbriqué.
 * Tout caractère non matché est rendu tel quel.
 */
function parseInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Regex combinée — chaque alternative produit un groupe captureur dédié
  const regex = /\*\*([^*]+?)\*\*|\*([^*]+?)\*|\[([^\]]+?)\]\(([^)]+?)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      parts.push(<strong key={key++}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(<em key={key++}>{match[2]}</em>);
    } else if (match[3] !== undefined && match[4] !== undefined) {
      parts.push(
        <a key={key++} href={match[4]}>
          {match[3]}
        </a>,
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function Block({ block }: { block: NewsBlock }): React.ReactElement | null {
  switch (block.type) {
    case 'paragraph':
      return <p>{parseInline(block.content)}</p>;
    case 'heading':
      return <h2>{parseInline(block.content)}</h2>;
    case 'subheading':
      return <h3>{parseInline(block.content)}</h3>;
    case 'pullquote':
      return (
        <blockquote className={styles.pullquote}>
          {parseInline(block.content)}
          {block.attribution && <footer>— {block.attribution}</footer>}
        </blockquote>
      );
    case 'image':
      return (
        <figure className={styles.inset}>
          <img src={block.src} alt={block.alt ?? ''} loading="lazy" />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
  }
}

export default function NewsArticle({
  news,
  related,
}: {
  news: NewsItem;
  related: NewsItem[];
}): React.ReactElement {
  return (
    <div className={styles.page}>
      {/* ───── Topbar (mode visiteur, sur fond ivory) ───── */}
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand} aria-label="Nemo — Accueil">
          NE<span>M</span>O
        </Link>
        <nav className={styles.nav} aria-label="Principal">
          <Link href="/races">Courses</Link>
          <Link href="/ranking">Classement</Link>
        </nav>
        <Link href="/login" className={styles.loginCta}>
          Se connecter
        </Link>
      </header>

      {/* ───── Breadcrumb ───── */}
      <nav className={styles.crumbs} aria-label="Fil d'ariane">
        <Link href="/">Accueil</Link>
        <span className={styles.sep}>/</span>
        <Link href={'/news' as LinkHref}>Journal de bord</Link>
        <span className={styles.sep}>/</span>
        <span className={styles.cur}>{CATEGORY_LABEL[news.category]}</span>
      </nav>

      {/* ───── Head article ───── */}
      <section className={styles.head}>
        <div className={styles.headLeft}>
          <div className={styles.meta}>
            <span className={styles.catChip}>
              {CATEGORY_LABEL[news.category]}
            </span>
            <span className={styles.dotSep} aria-hidden />
            <span className={styles.date}>
              {formatNewsDate(news.publishedAt)}
            </span>
            <span className={styles.dotSep} aria-hidden />
            <span className={styles.readingTime}>
              Lecture {news.readingTimeMin} min
            </span>
          </div>
          <h1 className={styles.headline}>{news.title}</h1>
          <p className={styles.standfirst}>{parseInline(news.standfirst)}</p>
        </div>

        <aside className={styles.byline}>
          <div className={styles.author}>
            <div className={styles.authorAvatar} aria-hidden>
              {news.authorInitials}
            </div>
            <div>
              <p className={styles.authorLabel}>{news.authorRole}</p>
              <p className={styles.authorName}>{news.authorName}</p>
            </div>
          </div>
        </aside>
      </section>

      {/* ───── Image hero ───── */}
      {news.imageUrl && (
        <div className={styles.heroImg}>
          <figure>
            <img
              src={news.imageUrl}
              alt={news.imageAlt ?? ''}
              fetchPriority="high"
            />
            {news.imageCaption && (
              <figcaption>{parseInline(news.imageCaption)}</figcaption>
            )}
          </figure>
        </div>
      )}

      {/* ───── Corps article ───── */}
      <article className={styles.body}>
        {news.body.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </article>

      {/* ───── Signature + retour ───── */}
      <div className={styles.signature}>
        <p>
          {news.authorRole} <strong>{news.authorName}</strong>
        </p>
        <p>
          Publié le <strong>{formatNewsDate(news.publishedAt)}</strong>
        </p>
      </div>

      <div className={styles.backRow}>
        <Link href={'/news' as LinkHref} className={styles.backLink}>
          <span className={styles.backArrow}>←</span> Retour au journal de bord
        </Link>
      </div>

      {/* ───── Lire aussi ───── */}
      {related.length > 0 && (
        <section className={styles.related}>
          <div className={styles.relatedInner}>
            <header className={styles.relatedHead}>
              <div>
                <p className={styles.relatedEyebrow}>Dans le journal</p>
                <h2>Lire aussi.</h2>
              </div>
              <Link
                href={'/news' as LinkHref}
                className={styles.relatedLink}
              >
                Toutes les actualités <span>→</span>
              </Link>
            </header>

            <div className={styles.relatedGrid}>
              {related.map((n) => (
                <NewsCard key={n.id} news={n} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
