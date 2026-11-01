import { describe, expect, it } from 'vitest'
import { buildModes } from '../../../server/services/catalog/modes'

const store = { dineInEnabled: true, pickupEnabled: true, deliveryEnabled: false }

describe('buildModes', () => {
  it('mirrors the store flags', () => {
    expect(buildModes(store, 0)).toEqual({ dineIn: true, pickup: true, delivery: { enabled: false, available: false } })
    expect(buildModes({ ...store, dineInEnabled: false }, 0).dineIn).toBe(false)
  })

  it('delivery is enabled but unavailable until an active zone exists', () => {
    const delivery = { ...store, deliveryEnabled: true }
    expect(buildModes(delivery, 0).delivery).toEqual({ enabled: true, available: false })
    expect(buildModes(delivery, 2).delivery).toEqual({ enabled: true, available: true })
  })

  it('zones alone do not make delivery available when the mode is off', () => {
    expect(buildModes(store, 3).delivery).toEqual({ enabled: false, available: false })
  })
})
