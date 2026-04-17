'use client';

import { useEffect } from 'react';
import { useGameStore } from '@/lib/store';

/**
 * Global keyboard shortcuts for the play screen.
 * Only active when canInteract is true (player mode).
 */
export function useHotkeys(canInteract: boolean): void {
  useEffect(() => {
    if (!canInteract) return;

    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      const store = useGameStore.getState();

      switch (e.key) {
        case 'v':
        case 'V':
          e.preventDefault();
          if (store.panel.activePanel === 'sails') store.closePanel();
          else store.openPanel('sails');
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          if (store.panel.activePanel === 'programming') store.closePanel();
          else store.openPanel('programming');
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          if (store.panel.activePanel === 'ranking') store.closePanel();
          else store.openPanel('ranking');
          break;
        case ' ':
          e.preventDefault();
          store.setFollowBoat(true);
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          store.goLive();
          break;
        case 'Escape':
          // Close any open panel (compass handles its own Escape)
          if (store.panel.activePanel) {
            e.preventDefault();
            store.closePanel();
          }
          break;
        case '+':
        case '=':
          e.preventDefault();
          store.setMapView(store.map.center, Math.min(store.map.zoom + 1, 18));
          break;
        case '-':
          e.preventDefault();
          store.setMapView(store.map.center, Math.max(store.map.zoom - 1, 1));
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canInteract]);
}
