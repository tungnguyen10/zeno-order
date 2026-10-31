import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../server/db/client', () => ({
  getDb: () => ({ execute: () => Promise.reject(new Error('connect failed postgres://user:secret@host/db')) }),
}))

afterEach(() => vi.restoreAllMocks())

describe('health handler', () => {
  it('returns 503 SERVICE_UNAVAILABLE without leaking connection details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = errorSpy.mock.calls[0]![0] as string
    expect(line).not.toContain('user:secret')
    expect(JSON.parse(line)).toMatchObject({
      msg: 'api.unhandled',
      requestId: 'test-request',
      err: { name: 'AppError' },
      cause: { message: 'connect failed postgres://[REDACTED]' },
    })
  })
})
