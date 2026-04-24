import { useEffect, useState } from 'react';

/**
 * Layout paliers for the right-stack (action buttons + compass).
 * Picked based on viewport dimensions so the action buttons remain visible
 * on small tablets and phones-landscape, where a full-size compass would
 * otherwise push the buttons off-screen.
 */
export type CompassLayout = 'stack-vertical' | 'bar-horizontal' | 'side-by-side';

/**
 * Pure decision function — exported so it can be tested directly without
 * mounting a React tree.
 */
export function pickCompassLayout(height: number, width: number): CompassLayout {
  if (height >= 480) return 'stack-vertical';
  if (height >= 360 && width >= 720) return 'bar-horizontal';
  return 'side-by-side';
}

export function useCompassLayout(): CompassLayout {
  const [layout, setLayout] = useState<CompassLayout>('stack-vertical');

  useEffect(() => {
    const compute = (): void => {
      setLayout(pickCompassLayout(window.innerHeight, window.innerWidth));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  return layout;
}
