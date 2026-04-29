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

export interface ProgState {
  draft: ProgDraft;
  committed: ProgDraft;
}
