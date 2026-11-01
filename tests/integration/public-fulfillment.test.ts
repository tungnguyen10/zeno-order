import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { storeTables, stores } from '../../server/db/schema'
import { getPublicFulfillment } from '../../server/services/catalog/public-fulfillment'
import { createTable, regenerateTable } from '../../server/services/catalog/tables'
import { resetDb } from '../support/db'
import { createTable as seedTable, createTenant, createZone } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

const db = () => getDb()
const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('getPublicFulfillment — store resolution', () => {
  it('NOT_FOUND for unknown or suspended stores', async () => {
    await expect(getPublicFulfillment(db(), 'khong-co', undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const t = await createTenant('susp')
    await db().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, t.store.id))
    await expect(getPublicFulfillment(db(), t.store.slug, undefined)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('getPublicFulfillment — table token', () => {
  it('has no table and no error without a token', async () => {
    const t = await createTenant('none')
    expect(await getPublicFulfillment(db(), t.store.slug, undefined)).toMatchObject({ table: null, tableError: null })
  })

  it('resolves a valid token to the table display name only', async () => {
    const t = await createTenant('ok')
    const { token } = await seedTable(t.store, '05')
    const result = await getPublicFulfillment(db(), t.store.slug, token)
    expect(result).toMatchObject({ table: { displayName: 'Bàn 05' }, tableError: null })
    expect(Object.keys(result.table!)).toEqual(['displayName'])
  })

  it.each([['empty', ''], ['garbage', 'khong-phai-token'], ['500 chars', 'a'.repeat(500)]])('INVALID_TABLE for a %s token', async (_label, token) => {
    const t = await createTenant('bad')
    await seedTable(t.store, '05')
    expect(await getPublicFulfillment(db(), t.store.slug, token)).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
  })

  it('INVALID_TABLE for a token that belongs to another store, without revealing that table', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const theirs = await seedTable(b.store, '09', { displayName: 'Bàn bí mật' })
    const result = await getPublicFulfillment(db(), a.store.slug, theirs.token)
    expect(result).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    expect(JSON.stringify(result)).not.toContain('Bàn bí mật')
  })

  it('INVALID_TABLE once the table is revoked', async () => {
    const t = await createTenant('rev')
    const { table, token } = await seedTable(t.store, '01')
    await db().update(storeTables).set({ active: false }).where(eq(storeTables.id, table.id))
    expect(await getPublicFulfillment(db(), t.store.slug, token)).toMatchObject({ tableError: 'INVALID_TABLE' })
  })

  it('INVALID_TABLE for the old token after regenerate, valid for the new one', async () => {
    const t = await createTenant('regen')
    const created = await createTable(db(), ctxOf(t), {}, 'https://zeno.test')
    const oldToken = new URL(created.qrUrl).searchParams.get('t')!
    const renewed = await regenerateTable(db(), ctxOf(t), created.id, 'https://zeno.test')
    const newToken = new URL(renewed.qrUrl).searchParams.get('t')!

    expect(await getPublicFulfillment(db(), t.store.slug, oldToken)).toMatchObject({ table: null, tableError: 'INVALID_TABLE' })
    expect(await getPublicFulfillment(db(), t.store.slug, newToken)).toMatchObject({ table: { displayName: 'Bàn 01' }, tableError: null })
  })
})

describe('getPublicFulfillment — modes and zones', () => {
  it('lists only active zones, only when delivery is enabled', async () => {
    const t = await createTenant('zones')
    await createZone(t.store, { name: 'Quận 1', feeVnd: 15000, position: 0 })
    await createZone(t.store, { name: 'Ẩn', feeVnd: 1000, active: false, position: 1 })

    const off = await getPublicFulfillment(db(), t.store.slug, undefined)
    expect(off.deliveryZones).toEqual([])
    expect(off.modes.delivery).toEqual({ enabled: false, available: false })

    await db().update(stores).set({ deliveryEnabled: true }).where(eq(stores.id, t.store.id))
    const on = await getPublicFulfillment(db(), t.store.slug, undefined)
    expect(on.modes.delivery).toEqual({ enabled: true, available: true })
    expect(on.deliveryZones.map(z => [z.name, z.feeVnd])).toEqual([['Quận 1', 15000]])
    expect(Object.keys(on.deliveryZones[0]!).sort()).toEqual(['feeVnd', 'id', 'name'])
  })

  it('never leaks tenant fields', async () => {
    const t = await createTenant('leak')
    await db().update(stores).set({ deliveryEnabled: true }).where(eq(stores.id, t.store.id))
    await createZone(t.store)
    const { token } = await seedTable(t.store, '01')
    const result = await getPublicFulfillment(db(), t.store.slug, token)
    expect(findForbiddenKeys(result)).toEqual([])
    expect(JSON.stringify(result)).not.toContain(t.org.id)
  })
})
