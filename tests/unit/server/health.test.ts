import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../server/db/client', () => ({
  getDb: () => ({ execute: () => Promise.reject(new Error('connect failed postgres://user:secret@host/db')) }),
}))

describe('health handler', () => {
  it('returns 503 SERVICE_UNAVAILABLE without leaking connection details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { default: handler } = await import('../../../server/api/health.get')
    const req = new IncomingMessage(new Socket())
    req.method = 'GET'
    req.url = '/api/health'
    const res = new ServerResponse(req)
    const event = createEvent(req, res)
    event.context.requestId = 'test-request'
    const body = await handler(event)
    expect(res.statusCode).toBe(503)
    expect(body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Cơ sở dữ liệu không khả dụng' })
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })
})
