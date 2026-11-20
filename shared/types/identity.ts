import type { OpeningHours } from '../store-hours'

export type StoreRole = 'OWNER' | 'STAFF'

export interface StoreSummary {
  id: string
  orgId: string
  name: string
  slug: string
  role: StoreRole
  isAcceptingOrders: boolean
}

export interface StoreDetail extends StoreSummary {
  dineInEnabled: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
  openingHours: OpeningHours | null
  /** ISO timestamp of a temporary pause, or null when not paused. */
  pausedUntil: string | null
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  role: 'OWNER'
}

export interface MeResponse {
  user: { id: string, email: string, displayName: string | null }
  organizations: OrganizationSummary[]
  stores: StoreSummary[]
}
