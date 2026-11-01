import type { PublicModes } from '#shared/types/catalog'

export function buildModes(
  store: { dineInEnabled: boolean, pickupEnabled: boolean, deliveryEnabled: boolean },
  activeZoneCount: number,
): PublicModes {
  return {
    dineIn: store.dineInEnabled,
    pickup: store.pickupEnabled,
    delivery: { enabled: store.deliveryEnabled, available: store.deliveryEnabled && activeZoneCount > 0 },
  }
}
