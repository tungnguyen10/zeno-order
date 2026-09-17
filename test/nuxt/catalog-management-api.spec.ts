import type { SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import { createError, getHeader, getResponseHeader } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { CatalogManagementError } from '../../server/repositories/catalog-management.repository'
import { parseBearerToken } from '../../server/utils/merchant-auth'
import { createManagementHandler, createCatalogCreateHandler, createCatalogUpdateHandler, createCatalogDeleteHandler, createSoldOutHandler, createSettingsHandler, createHoursHandler, createMemberCreateHandler, createMemberUpdateHandler, createMemberDeleteHandler } from '../../server/utils/catalog-management-http'
import type { CatalogManagementHandlerDeps } from '../../server/utils/catalog-management-http'

const storeId = '11111111-1111-4111-8111-111111111111'
const resourceId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const hours = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, isClosed: true, openTime: null, closeTime: null }))
const cases = [
  { factory: createManagementHandler, method: 'getSnapshot', body: undefined, args: [storeId, userId] },
  { factory: createCatalogCreateHandler, method: 'createResource', body: { name: 'Tea', slug: 'tea', basePrice: '1000' }, args: [storeId, 'products', { name: 'Tea', slug: 'tea', basePrice: '1000', description: null, imagePath: null, isActive: true, isSoldOut: false }] },
  { factory: createCatalogUpdateHandler, method: 'updateResource', body: { name: 'Tea' }, args: [storeId, 'products', resourceId, { name: 'Tea' }] },
  { factory: createCatalogDeleteHandler, method: 'deleteResource', body: undefined, args: [storeId, 'products', resourceId] },
  { factory: createSoldOutHandler, method: 'setSoldOut', body: { isSoldOut: true }, args: [storeId, resourceId, true] },
  { factory: createSettingsHandler, method: 'updateSettings', body: { name: 'Shop' }, args: [storeId, { name: 'Shop' }] },
  { factory: createHoursHandler, method: 'replaceHours', body: hours, args: [storeId, hours] },
  { factory: createMemberCreateHandler, method: 'addMember', body: { userId, role: 'staff' }, args: [storeId, { userId, role: 'staff' }] },
  { factory: createMemberUpdateHandler, method: 'updateMember', body: { role: 'manager' }, args: [storeId, userId, { role: 'manager' }] },
  { factory: createMemberDeleteHandler, method: 'removeMember', body: undefined, args: [storeId, userId] },
] as const
function setup(body: unknown, params: Record<string, string> = {}, authorization: string | undefined = 'Bearer valid-token') {
  const headers = new Map<string, string>()
  const event = { context: { params: { storeId, resource: 'products', resourceId, productId: resourceId, userId, ...params } }, node: { req: { headers: { authorization } }, res: { statusCode: 200, getHeader: (name: string) => headers.get(name.toLowerCase()), setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), String(value)) } } } as unknown as H3Event
  const client = { jwtScoped: true } as unknown as SupabaseClient
  const methods = Object.fromEntries(cases.map(row => [row.method, vi.fn().mockResolvedValue({ ok: true })]))
  const repository = vi.fn().mockReturnValue(methods)
  const authenticate = vi.fn(async (event: H3Event) => {
    if (parseBearerToken(getHeader(event, 'authorization')) !== 'valid-token') throw createError({ statusCode: 401, statusMessage: 'Invalid bearer' })
    return { client, user: { id: userId } }
  })
  const readBody = vi.fn().mockResolvedValue(body)
  const deps: CatalogManagementHandlerDeps = { authenticate, repository, readBody }
  return { event, client, methods, repository, authenticate, readBody, deps }
}

describe('management handler contract', () => {
  it.each(cases)('$method uses the authenticated client, validated input, and private no-store', async ({ factory, method, body, args }) => {
    const test = setup(body)
    await expect(factory(test.deps)(test.event)).resolves.toEqual({ ok: true })
    expect(test.authenticate).toHaveBeenCalledWith(test.event)
    expect(test.repository).toHaveBeenCalledWith(test.client)
    expect(test.methods[method]).toHaveBeenCalledWith(...args)
    expect(getResponseHeader(test.event, 'cache-control')).toBe('private, no-store')
  })
  it.each(cases)('$method rejects absent/invalid bearer authentication before repository access', async ({ factory, body }) => {
    for (const authorization of ['', 'Basic abc', 'Bearer invalid-token']) {
      const test = setup(body, {}, authorization)
      await expect(factory(test.deps)(test.event)).rejects.toMatchObject({ statusCode: 401 })
      expect(test.repository).not.toHaveBeenCalled()
      expect(getResponseHeader(test.event, 'cache-control')).toBe('private, no-store')
    }
  })
  it.each(cases)('$method rejects invalid store ids', async ({ factory, body }) => {
    const test = setup(body, { storeId: 'bad' })
    await expect(factory(test.deps)(test.event)).rejects.toMatchObject({ statusCode: 400 })
    expect(test.repository).not.toHaveBeenCalled()
  })
  it.each(cases.filter(row => row.body !== undefined))('$method rejects unknown body fields', async ({ factory }) => {
    const test = setup({ store_id: 'evil' })
    await expect(factory(test.deps)(test.event)).rejects.toMatchObject({ statusCode: 400 })
    expect(test.repository).not.toHaveBeenCalled()
  })
  it('rejects invalid resource names, resource ids, and composite ids', async () => {
    const invalidParams: Record<string, string>[] = [{ resource: 'stores' }, { resourceId: 'bad' }, { resource: 'product-option-groups', resourceId: `${resourceId}:bad` }]
    for (const params of invalidParams) {
      const test = setup({ sortOrder: 1 }, params)
      await expect(createCatalogUpdateHandler(test.deps)(test.event)).rejects.toMatchObject({ statusCode: 400 })
      expect(test.repository).not.toHaveBeenCalled()
    }
  })
  it('rejects invalid product and member ids', async () => {
    const sold = setup({ isSoldOut: true }, { productId: 'bad' })
    await expect(createSoldOutHandler(sold.deps)(sold.event)).rejects.toMatchObject({ statusCode: 400 })
    const member = setup({ role: 'staff' }, { userId: 'bad' })
    await expect(createMemberUpdateHandler(member.deps)(member.event)).rejects.toMatchObject({ statusCode: 400 })
  })
  it('accepts a valid composite option link token', async () => {
    const id = `${resourceId}:${userId}`
    const test = setup({ sortOrder: 2 }, { resource: 'product-option-groups', resourceId: id })
    await createCatalogUpdateHandler(test.deps)(test.event)
    expect(test.methods.updateResource).toHaveBeenCalledWith(storeId, 'product-option-groups', id, { sortOrder: 2 })
  })
  it('maps malformed JSON to 400 without leaking parser details', async () => {
    const test = setup(undefined)
    test.readBody.mockRejectedValue(new SyntaxError('secret body parse detail'))
    const error = await createSettingsHandler(test.deps)(test.event).catch(error => error) as { statusCode: number, message: string }
    expect(error.statusCode).toBe(400)
    expect(error.message).not.toContain('secret')
  })
  it.each([['FORBIDDEN', 403], ['NOT_FOUND', 404], ['CONFLICT', 409], ['INTERNAL', 500]] as const)('maps %s repository errors to %i for every handler', async (code, statusCode) => {
    for (const { factory, method, body } of cases) {
      const test = setup(body)
      test.methods[method]!.mockRejectedValue(new CatalogManagementError(code))
      await expect(factory(test.deps)(test.event)).rejects.toMatchObject({ statusCode })
      expect(getResponseHeader(test.event, 'cache-control')).toBe('private, no-store')
    }
  })
  it('never passes through untrusted error messages or status codes', async () => {
    const test = setup({ isSoldOut: true })
    test.methods.setSoldOut!.mockRejectedValue(createError({ statusCode: 403, message: 'secret postgres message' }))
    const error = await createSoldOutHandler(test.deps)(test.event).catch(error => error) as { statusCode: number, message: string }
    expect(error.statusCode).toBe(500)
    expect(error.message).not.toContain('secret')
  })
})
