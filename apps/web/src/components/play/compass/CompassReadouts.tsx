/**
 * 3-column compass readouts: Vitesse · Cap · TWA. Pure, prop-driven, no store.
 *
 * Extracted from `apps/web/src/components/play/Compass.tsx`. Consumers
 * (live `Compass`, future ProgPanel cap-editor) compute the values and
 * styling classes (vmgGlow / bspColorClass) themselves and pass them down.
 *
 * The optional `pendingHint` is rendered as a floating bar above the
 * readouts. The consumer's wrapper is responsible for `position: relative`
 * so the absolute-positioned hint anchors correctly.
 */

'use client';

import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import styles from './CompassReadouts.module.css';
import compassStyles from '../Compass.module.css';

export interface CompassReadoutsProps {
  headingDeg: number;
  twaDeg: number;
  /** Boat speed in knots. Omit to hide the Vitesse cell entirely. */
  bspKn?: number;
  /** Apply a green tint to the TWA cell when in a VMG-optimal band. */
  vmgGlow: boolean;
  /** Optional CSS module class for the BSP cell color (live | warn | danger). */
  bspColorClass?: 'live' | 'warn' | 'danger';
  /** Optional manoeuvre hint rendered above the readouts. */
  pendingHint?: {
    label: string;
    className: 'hintGybe' | 'hintTack' | 'hintSail';
  } | undefined;
}

export default function CompassReadouts({
  headingDeg,
  twaDeg,
  bspKn,
  vmgGlow,
  bspColorClass,
  pendingHint,
}: CompassReadoutsProps): ReactElement {
  const t = useTranslations('play.compassReadouts');
  const bspClass = bspColorClass ? styles[bspColorClass] : '';
  return (
    <>
      {pendingHint && (
        <div className={`${compassStyles.floatingHint} ${compassStyles[pendingHint.className]}`}>
          <span className={compassStyles.hintIcon}>
            <AlertTriangle size={12} strokeWidth={2.5} />
          </span>
          <span>{pendingHint.label}</span>
        </div>
      )}
      <div className={styles.readouts}>
        {bspKn !== undefined && (
          <div>
            <p className={styles.readoutLabel}>{t('speed')}</p>
            <p className={`${styles.readoutValue} ${bspClass}`}>
              {bspKn.toFixed(2)} <small>nds</small>
            </p>
          </div>
        )}
        <div>
          <p className={styles.readoutLabel}>{t('heading')}</p>
          <p className={`${styles.readoutValue} ${styles.gold}`}>{Math.round(headingDeg)}°</p>
        </div>
        <div>
          <p className={styles.readoutLabel}>{t('twa')}</p>
          <p className={`${styles.readoutValue} ${vmgGlow ? styles.live : ''}`}>
            {Math.round(twaDeg)}°
          </p>
        </div>
      </div>
    </>
  );
}
