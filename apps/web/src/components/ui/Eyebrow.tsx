import type { ReactNode } from 'react';
import styles from './Eyebrow.module.css';

export interface EyebrowProps {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

/**
 * Surtitre éditorial (trait gold + texte Space Mono uppercase).
 * Utilisé au-dessus des headlines pour rythmer la page à la North Sails /
 * Rolex / Roland-Garros.
 */
export function Eyebrow({ children, trailing, className }: EyebrowProps): React.ReactElement {
  return (
    <p className={`${styles.eyebrow} ${className ?? ''}`}>
      <span>{children}</span>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </p>
  );
}
