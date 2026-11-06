import { fileURLToPath } from 'node:url'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

describe('GET /api/health', () => {
  it('returns ok when the database answers', async () => {
    expect(await $fetch('/api/health')).toEqual({ status: 'ok' })
  })

  it('sets an x-request-id header', async () => {
    const res = await fetch('/api/health')
    expect(res.headers.get('x-request-id')).toMatch(/^[\w-]{8,64}$/)
  })

  it('generates its own correlation ID instead of reflecting untrusted header values', async () => {
    const res = await fetch('/api/health', { headers: { 'x-request-id': 'req-12345678' } })
    expect(res.headers.get('x-request-id')).not.toBe('req-12345678')
    expect(res.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/)
  })
})

describe('API error format outside matched routes', () => {
  it('returns NOT_FOUND for unknown /api paths', async () => {
    const res = await fetch('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Không tìm thấy' })
  })

  it('returns the API error body for a wrong method', async () => {
    const res = await fetch('/api/health', { method: 'POST' })
    // The catch-all route answers unmatched methods, so this is 404 rather than 405.
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Không tìm thấy' })
  })
})
