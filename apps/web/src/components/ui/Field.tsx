import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  action?: ReactNode;
  error?: string;
}

export function Field({
  label,
  hint,
  action,
  error,
  id,
  className,
  ...rest
}: FieldProps): React.ReactElement {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        <span>
          {label}
          {hint && <span className={styles.hint}> · {hint}</span>}
        </span>
        {action}
      </label>
      <input
        id={fieldId}
        className={`${styles.input} ${className ?? ''}`}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
