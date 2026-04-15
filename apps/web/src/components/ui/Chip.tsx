import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.css';

type ChipVariant = 'neutral' | 'live' | 'open' | 'soon' | 'past' | 'gold';

export interface ChipProps {
  variant?: ChipVariant;
  active?: boolean;
  interactive?: boolean;
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  children: ReactNode;
  className?: string;
}

const VARIANT_CLASS: Record<ChipVariant, string | undefined> = {
  neutral: undefined,
  live: 'live',
  open: 'open',
  soon: 'soon',
  past: 'past',
  gold: 'gold',
};

export function Chip({
  variant = 'neutral',
  active = false,
  interactive = false,
  onClick,
  className,
  children,
}: ChipProps): React.ReactElement {
  const variantKey = VARIANT_CLASS[variant];
  const cls = [
    styles.chip,
    variantKey ? styles[variantKey] : '',
    interactive ? styles.interactive : '',
    active ? styles.active : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  if (interactive || onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {variant === 'live' && <span className={styles.liveDot} />}
        {children}
      </button>
    );
  }
  return (
    <span className={cls}>
      {variant === 'live' && <span className={styles.liveDot} />}
      {children}
    </span>
  );
}
