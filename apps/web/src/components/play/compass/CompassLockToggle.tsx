/**
 * TWA lock toggle button. Pure, prop-driven, no store.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`. The wrapper
 * `Compass` (live use) wraps this in a `<Tooltip>` to show the keyboard
 * shortcut; the ProgPanel cap-editor (Phase 2) will use it without a
 * tooltip. Keep the styling here minimal — visual classes come from
 * `Compass.module.css` because this primitive intentionally piggybacks on
 * the action-button look (.actionBtn / .locked).
 */

import type { ReactElement } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import styles from '../Compass.module.css';

export interface CompassLockToggleProps {
  locked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}

export default function CompassLockToggle({
  locked,
  onToggle,
  disabled = false,
  className,
}: CompassLockToggleProps): ReactElement {
  const cls = [styles.actionBtn, locked ? styles.locked : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} onClick={onToggle} disabled={disabled}>
      {locked ? <Lock size={14} strokeWidth={2.5} /> : <LockOpen size={14} strokeWidth={2.5} />}
      <span>TWA</span>
    </button>
  );
}
