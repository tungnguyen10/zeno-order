import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createZone, listZones, updateZone } from '../../server/services/catalog/delivery-zones'
import { updateFulfillment } from '../../server/services/catalog/fulfillment'
import { resetDb } from '../support/db'
import { createStore, createTenant, createZone as seedZone } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string } }, store: { id: string }): StoreContext => ({
  userId: t.owner.userId, orgId: t.org.id, storeId: store.id, role: 'OWNER',
})
beforeEach(async () => { await resetDb() })
afterAll(async () => { await closeDb() })

describe('updateFulfillment', () => {
  it('toggles individual modes and keeps the others', async () => {
    const t = await createTenant('ful')
    expect(await updateFulfillment(getDb(), ctxOf(t, t.store), { deliveryEnabled: true })).toMatchObject({ dineInEnabled: true, pickupEnabled: true, deliveryEnabled: true })
    expect(await updateFulfillment(getDb(), ctxOf(t, t.store), { dineInEnabled: false })).toMatchObject({ dineInEnabled: false, pickupEnabled: true, deliveryEnabled: true })
  })
  it('allows enabling delivery before any zone exists', async () => {
    const t = await createTenant('nozone')
    expect((await updateFulfillment(getDb(), ctxOf(t, t.store), { deliveryEnabled: true })).deliveryEnabled).toBe(true)
  })
  it('refuses to turn every mode off and leaves the store unchanged', async () => {
    const t = await createTenant('off')
    await expect(updateFulfillment(getDb(), ctxOf(t, t.store), { dineInEnabled: false, pickupEnabled: false })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(await updateFulfillment(getDb(), ctxOf(t, t.store), { pickupEnabled: true })).toMatchObject({ dineInEnabled: true, pickupEnabled: true })
  })
  it('two concurrent requests cannot together turn off the last two modes', async () => {
    const t = await createTenant('race')
    const results = await Promise.allSettled([updateFulfillment(getDb(), ctxOf(t, t.store), { dineInEnabled: false }), updateFulfillment(getDb(), ctxOf(t, t.store), { pickupEnabled: false })])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
    const detail = await updateFulfillment(getDb(), ctxOf(t, t.store), { deliveryEnabled: false })
    expect([detail.dineInEnabled, detail.pickupEnabled, detail.deliveryEnabled].some(Boolean)).toBe(true)
  })
  it('cannot change a store the caller context does not own', async () => {
    const a = await createTenant('owna'); const b = await createTenant('ownb')
    await expect(updateFulfillment(getDb(), ctxOf(a, b.store), { deliveryEnabled: true })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('delivery zones', () => {
  it('creates zones in order and lists active and inactive ones', async () => {
    const t = await createTenant('zones')
    const first = await createZone(getDb(), ctxOf(t, t.store), { name: 'Quận 1', feeVnd: 15000 })
    const second = await createZone(getDb(), ctxOf(t, t.store), { name: 'Quận 3', feeVnd: 0 })
    expect([first.position, second.position]).toEqual([0, 1])
    await updateZone(getDb(), ctxOf(t, t.store), second.id, { active: false })
    expect((await listZones(getDb(), ctxOf(t, t.store))).map(z => [z.name, z.feeVnd, z.active])).toEqual([['Quận 1', 15000, true], ['Quận 3', 0, false]])
  })
  it('updates name and fee', async () => {
    const t = await createTenant('upd')
    const zone = await createZone(getDb(), ctxOf(t, t.store), { name: 'Cũ', feeVnd: 10000 })
    expect(await updateZone(getDb(), ctxOf(t, t.store), zone.id, { name: 'Mới', feeVnd: 20000 })).toMatchObject({ name: 'Mới', feeVnd: 20000 })
  })
  it('scopes zones to the store and hides foreign ones', async () => {
    const a = await createTenant('za'); const b = await createTenant('zb'); const a2 = await createStore(a.org.id, 'a2')
    const theirs = await seedZone(b.store, { name: 'Của B' }); const sibling = await seedZone(a2, { name: 'Của A2' })
    await expect(updateZone(getDb(), ctxOf(a, a.store), theirs.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateZone(getDb(), ctxOf(a, a.store), sibling.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await listZones(getDb(), ctxOf(a, a.store))).toEqual([])
  })
})
