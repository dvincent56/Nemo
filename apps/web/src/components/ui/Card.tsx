import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import styles from './Card.module.css';

export interface CardProps {
  children: ReactNode;
  /** Si renseigné, rend la card comme un <Link> Next.js. */
  href?: string | undefined;
  /** Ajoute un liseré doré qui apparaît au hover. */
  accent?: boolean | undefined;
  className?: string | undefined;
}

export function Card({ children, href, accent = false, className }: CardProps): React.ReactElement {
  const cls = [
    styles.card,
    href ? styles.interactive : '',
    accent ? styles.accent : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (href) {
    return (
      <Link href={href as Parameters<typeof Link>[0]['href']} className={cls}>
        {children}
      </Link>
    );
  }
  return <div className={cls}>{children}</div>;
}

type DivProps = HTMLAttributes<HTMLDivElement>;
type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement>;
export type { DivProps, AnchorProps };
