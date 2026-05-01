import type { SailId } from '@nemo/shared-types';

export type ProgMode = 'cap' | 'wp';

export interface CapOrder {
  id: string;
  trigger: { type: 'AT_TIME'; time: number };
  heading: number;
  twaLock: boolean;
}

export interface WpOrder {
  id: string;
  trigger: { type: 'IMMEDIATE' } | { type: 'AT_WAYPOINT'; waypointOrderId: string };
  lat: number;
  lon: number;
  captureRadiusNm: number;
}

export interface FinalCapOrder {
  id: string;
  trigger: { type: 'AT_WAYPOINT'; waypointOrderId: string };
  heading: number;
  twaLock: boolean;
}

export interface SailOrder {
  id: string;
  trigger:
    | { type: 'AT_TIME'; time: number }
    | { type: 'AT_WAYPOINT'; waypointOrderId: string };
  action: { auto: false; sail: SailId } | { auto: true };
}

export interface ProgDraft {
  mode: ProgMode;
  capOrders: CapOrder[];
  wpOrders: WpOrder[];
  finalCap: FinalCapOrder | null;
  sailOrders: SailOrder[];
}

export const EMPTY_DRAFT: ProgDraft = {
  mode: 'cap',
  capOrders: [],
  wpOrders: [],
  finalCap: null,
  sailOrders: [],
};

/** Identifies which order is currently being edited in ProgPanel.
 *  Set by either ProgPanel (entering an editor sub-screen) or MapCanvas
 *  (clicking a marker). The `'NEW'` magic id (preserved from Phase 2a)
 *  signals "create" mode for cap/sail/wp; finalCap doesn't need an id
 *  because there's at most one. */
export type EditingOrder =
  | { kind: 'cap'; id: string }
  | { kind: 'sail'; id: string }
  | { kind: 'wp'; id: string }
  | { kind: 'finalCap'; id: string };

/** Transient toast surfaced by the prog panel — currently only used by the
 *  capture-detection effect to inform the user when an editor was force-
 *  closed because its order's referenced WP was just captured by the boat.
 *  `id` makes the value structurally distinct on each set so a new notice
 *  with the same message still triggers the auto-dismiss timer. */
export interface ProgNotice {
  id: string;
  message: string;
}

/** Live editor preview snapshot, published by CapEditor / SailEditor on every
 *  state change. Two consumers:
 *   1. The projection worker pipeline (`useProjectionLine.requestCompute`)
 *      splices `ghostOrder` into the draft segment list — replacing
 *      `replacesId` if set, appending otherwise — so the simulated polyline
 *      reflects the in-flight edit before the user clicks OK.
 *   2. The sliding marker layer (`prog-order-marker-preview`) reads
 *      `ghostOrder.trigger.time` (when AT_TIME) and places a distinct
 *      "preview" marker at that point on the live polyline.
 *  Cleared when the editor unmounts (cancel or save). */
export interface ProgEditorPreview {
  kind: 'cap' | 'sail';
  /** Fully-formed order in its current editor state. The `id` is either the
   *  real id of the order being edited, or a synthetic `editor-ghost-*`
   *  placeholder for a NEW order — the projection worker only cares about
   *  trigger + value, not the id. */
  ghostOrder: CapOrder | SailOrder;
  /** Real id of the order being edited; null when creating a NEW order.
   *  Used by the splice logic to know whether to replace or append. */
  replacesId: string | null;
}

export interface ProgState {
  draft: ProgDraft;
  committed: ProgDraft;
  /** Currently-edited order (set by ProgPanel + MapCanvas). null = no editor open.
   *  This is UI state — NOT included in commit/reset/clone — preserved across
   *  applyRouteAsCommitted so a marker click can drive the editor without
   *  being squashed by an incoming route apply. */
  editingOrder: EditingOrder | null;
  /** True when the WP editor is in "click on map to place" mode. Read by
   *  MapCanvas to enable map-click→add-wp + cursor change. */
  pickingWp: boolean;
  /** When a brand-new WP was just placed via map-click and the editor opened
   *  for it, holds that WP's id. The editor's "Annuler" path calls
   *  `removeWpOrder(pendingNewWpId)` to undo the tentative placement. Cleared
   *  on save (the WP is then a confirmed draft entry). */
  pendingNewWpId: string | null;
  /** Transient toast — auto-dismissed by ProgPanel after a few seconds. */
  notice: ProgNotice | null;
  /** Live editor preview — populated by CapEditor / SailEditor whenever the
   *  TimeStepper changes; cleared on editor close. Rendered as a sliding
   *  marker along the current projection so the player can see WHERE the
   *  order will fire before saving. */
  editorPreview: ProgEditorPreview | null;
}
