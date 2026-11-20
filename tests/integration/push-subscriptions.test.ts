import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { PushSubscriptionInput } from '#shared/schemas/push'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { listStoreSubscriptions, removeSubscription, saveSubscription } from '../../server/services/push/subscriptions'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'

const ctxOf = (t: { owner: { userId: string }, org: { id: string }, store: { id: string } }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: t.store.id,
  role: 'OWNER',
})

const sub = (endpoint: string): PushSubscriptionInput => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } })

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('push subscriptions', () => {
  it('stores a subscription and lists it for the store', async () => {
    const t = await createTenant('push')
    await saveSubscription(getDb(), ctxOf(t), sub('https://push.example/one'))
    const rows = await listStoreSubscriptions(getDb(), { orgId: t.org.id, storeId: t.store.id })
    expect(rows.map(r => r.endpoint)).toEqual(['https://push.example/one'])
  })

  it('upserts by endpoint instead of duplicating, updating the keys', async () => {
    const t = await createTenant('upsert')
    await saveSubscription(getDb(), ctxOf(t), { endpoint: 'https://push.example/x', keys: { p256dh: 'old', auth: 'old' } })
    await saveSubscription(getDb(), ctxOf(t), { endpoint: 'https://push.example/x', keys: { p256dh: 'new', auth: 'new' } })
    const rows = await listStoreSubscriptions(getDb(), { orgId: t.org.id, storeId: t.store.id })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ p256dh: 'new', auth: 'new' })
  })

  it('removes a subscription only within the owning store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await saveSubscription(getDb(), ctxOf(a), sub('https://push.example/a'))
    await removeSubscription(getDb(), ctxOf(b), 'https://push.example/a')
    expect(await listStoreSubscriptions(getDb(), { orgId: a.org.id, storeId: a.store.id })).toHaveLength(1)
    await removeSubscription(getDb(), ctxOf(a), 'https://push.example/a')
    expect(await listStoreSubscriptions(getDb(), { orgId: a.org.id, storeId: a.store.id })).toHaveLength(0)
  })

  it('does not leak subscriptions across stores', async () => {
    const a = await createTenant('iso-a')
    const b = await createTenant('iso-b')
    await saveSubscription(getDb(), ctxOf(a), sub('https://push.example/a'))
    await saveSubscription(getDb(), ctxOf(b), sub('https://push.example/b'))
    const rows = await listStoreSubscriptions(getDb(), { orgId: a.org.id, storeId: a.store.id })
    expect(rows.map(r => r.endpoint)).toEqual(['https://push.example/a'])
  })
})
