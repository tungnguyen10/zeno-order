import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { count, eq } from 'drizzle-orm'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, stores } from '../../server/db/schema'
import { addStaff, createCategory, createProduct, createTable, createTenant, createZone } from '../support/fixtures'
import { createOrderRow } from '../support/order-fixtures'
import { createPaymentSetup } from '../support/webhook-fixtures'
import { api, signer } from '../support/hardening'
import { discoverRoutes } from '../support/route-inventory'
import { resetDb } from '../support/db'

const routes = discoverRoutes().filter(route => /^\/api\/(?:stores\/:storeId|organizations\/:orgId)(?:\/|$)/.test(route.path))
let tokens: { ownerA: string, ownerB: string, staffA: string, disabledA: string }
let ids: Record<string, string>
let storeName: string
beforeAll(async () => {
  await resetDb()
  const a = await createTenant('matrix-a'); const b = await createTenant('matrix-b')
  const staff = await addStaff(a.store); const disabled = await addStaff(a.store, { status: 'DISABLED' })
  const cat = await createCategory(a.store, 'Matrix'); const product = await createProduct(a.store, { categoryId: cat.id })
  const table = await createTable(a.store, '01'); const zone = await createZone(a.store)
  const order = await createOrderRow(a.store); const payment = await createPaymentSetup(a)
  const auth = await signer()
  const sign = (user: { userId: string }) => auth.sign({ sub: user.userId })
  tokens = { ownerA: await sign(a.owner), ownerB: await sign(b.owner), staffA: await sign(staff), disabledA: await sign(disabled) }
  ids = { storeId: a.store.id, orgId: a.org.id, productId: product.id, categoryId: cat.id, tableId: table.table.id, zoneId: zone.id, orderId: order.id, integrationId: payment.integration.id, accountId: payment.account.id, userId: staff.userId, invitationId: randomUUID(), txId: randomUUID() }
  storeName = a.store.name
})
afterAll(closeDb)
describe('all discovered tenant-scoped routes on the production build', () => {
  for (const route of routes) {
    it(`${route.method} ${route.path} rejects anonymous, foreign owner and disabled staff`, async () => {
      expect(route.guard, `missing route guard in ${route.file}`).not.toBeNull()
      const path = route.path.replace(/:(\w+)/g, (_, name: string) => ids[name]!)
      expect(path).not.toMatch(/undefined/)
      const body = route.method === 'GET' ? undefined : {}
      for (const [token, status] of [[undefined, 401], [tokens.ownerB, 404], [tokens.disabledA, 404]] as const) {
        const result = await api(route.method, path, { token, body })
        expect(result.status).toBe(status)
        expect(result.text).not.toContain(storeName)
      }
      if (route.guard === 'requireStoreOwner' || route.guard === 'requireOrgOwner') {
        const result = await api(route.method, path, { token: tokens.staffA, body: route.path.endsWith('/mark-paid') ? { method: 'BANK_MANUAL' } : body })
        expect(result.status).toBe(route.guard === 'requireOrgOwner' ? 404 : 403)
      }
    })
  }
})
it('does not let denied writes alter store/order data', async () => {
  const [store] = await getDb().select().from(stores).where(eq(stores.id, ids.storeId!))
  expect(store!.name).toBe(storeName)
  expect(await getDb().select({ value: count() }).from(orders)).toEqual([{ value: 1 }])
})
it('every API route is classified; a newly added route cannot silently bypass review', () => {
  for (const route of discoverRoutes()) {
    const source = readFileSync(route.file, 'utf8')
    expect(source).toContain('defineApiHandler')
    if (route.guard) continue
    expect(route.path).toMatch(/^\/api\/(?:public\/|webhooks\/sepay\/|internal\/status$|health$|me$|stores$|organizations$|invitations\/)/)
  }
})
