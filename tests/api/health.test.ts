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

  it('echoes a well-formed incoming x-request-id', async () => {
    const res = await fetch('/api/health', { headers: { 'x-request-id': 'req-12345678' } })
    expect(res.headers.get('x-request-id')).toBe('req-12345678')
  })
})
