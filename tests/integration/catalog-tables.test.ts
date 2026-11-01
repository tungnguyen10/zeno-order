import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { createTable, listTables, regenerateTable, resolveActiveTable, updateTable } from '../../server/services/catalog/tables'
import { resetDb } from '../support/db'
import { createStore, createTable as seedTable, createTenant } from '../support/fixtures'

const BASE = 'https://zeno.test'

const ctxOf = (t: { owner: { userId: string }, org: { id: string } }, store: { id: string }): StoreContext => ({
  userId: t.owner.userId,
  orgId: t.org.id,
  storeId: store.id,
  role: 'OWNER',
})

const tokenOf = (qrUrl: string) => new URL(qrUrl).searchParams.get('t')!

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('createTable', () => {
  it('auto-numbers tables and returns the qr url exactly once', async () => {
    const t = await createTenant('tb')
    const first = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    const second = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    expect([first.code, first.displayName]).toEqual(['01', 'Bàn 01'])
    expect(second.code).toBe('02')
    expect(first.qrUrl).toBe(`${BASE}/s/${t.store.slug}?t=${tokenOf(first.qrUrl)}`)
    expect(tokenOf(first.qrUrl)).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const listed = await listTables(getDb(), ctxOf(t, t.store))
    expect(listed.map(x => x.code)).toEqual(['01', '02'])
    expect(JSON.stringify(listed)).not.toContain(tokenOf(first.qrUrl))
    expect(Object.keys(listed[0]!).sort()).toEqual(['active', 'code', 'displayName', 'id'])
  })

  it('accepts a manual code and display name, and rejects a duplicate code', async () => {
    const t = await createTenant('man')
    const table = await createTable(getDb(), ctxOf(t, t.store), { code: 'A1', displayName: 'Bàn cửa sổ' }, BASE)
    expect([table.code, table.displayName]).toEqual(['A1', 'Bàn cửa sổ'])
    await expect(createTable(getDb(), ctxOf(t, t.store), { code: 'A1' }, BASE)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('allows the same code in two stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await createTable(getDb(), ctxOf(a, a.store), { code: '05' }, BASE)
    await expect(createTable(getDb(), ctxOf(b, b.store), { code: '05' }, BASE)).resolves.toMatchObject({ code: '05' })
  })

  it('concurrent auto-creation yields distinct codes', async () => {
    const t = await createTenant('par')
    const created = await Promise.all(Array.from({ length: 5 }, () => createTable(getDb(), ctxOf(t, t.store), {}, BASE)))
    expect(created.map(x => x.code).sort()).toEqual(['01', '02', '03', '04', '05'])
  })
})

describe('resolveActiveTable', () => {
  it('resolves the token of an active table of that store only', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const created = await createTable(getDb(), ctxOf(a, a.store), {}, BASE)
    const token = tokenOf(created.qrUrl)
    expect(await resolveActiveTable(getDb(), a.store.id, token)).toEqual({ id: created.id, code: '01', displayName: 'Bàn 01' })
    expect(await resolveActiveTable(getDb(), b.store.id, token)).toBeNull()
  })

  it.each(['', 'garbage', 'a'.repeat(500)])('returns null for %j', async (token) => {
    const t = await createTenant('bad')
    await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    expect(await resolveActiveTable(getDb(), t.store.id, token)).toBeNull()
  })
})

describe('regenerateTable and revoke', () => {
  it('kills the old token immediately and activates the new one', async () => {
    const t = await createTenant('regen')
    const created = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    const oldToken = tokenOf(created.qrUrl)
    const renewed = await regenerateTable(getDb(), ctxOf(t, t.store), created.id, BASE)
    const newToken = tokenOf(renewed.qrUrl)

    expect(newToken).not.toBe(oldToken)
    expect(await resolveActiveTable(getDb(), t.store.id, oldToken)).toBeNull()
    expect(await resolveActiveTable(getDb(), t.store.id, newToken)).toMatchObject({ id: created.id })
  })

  it('revoking (active=false) stops the token; regenerating re-activates the table', async () => {
    const t = await createTenant('revoke')
    const created = await createTable(getDb(), ctxOf(t, t.store), {}, BASE)
    const token = tokenOf(created.qrUrl)
    expect(await updateTable(getDb(), ctxOf(t, t.store), created.id, { active: false })).toMatchObject({ active: false })
    expect(await resolveActiveTable(getDb(), t.store.id, token)).toBeNull()

    const renewed = await regenerateTable(getDb(), ctxOf(t, t.store), created.id, BASE)
    expect(renewed.active).toBe(true)
    expect(await resolveActiveTable(getDb(), t.store.id, tokenOf(renewed.qrUrl))).not.toBeNull()
  })

  it('cannot touch a table of another store or org (NOT_FOUND)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const a2 = await createStore(a.org.id, 'a2')
    const theirs = await seedTable(b.store, '01')
    const sibling = await seedTable(a2, '01')
    for (const id of [theirs.table.id, sibling.table.id]) {
      await expect(updateTable(getDb(), ctxOf(a, a.store), id, { active: false })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(regenerateTable(getDb(), ctxOf(a, a.store), id, BASE)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await resolveActiveTable(getDb(), b.store.id, theirs.token)).not.toBeNull()
  })
})
