import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetJwtVerifierForTests } from '../../../../server/auth/jwt'
import { requireUser } from '../../../../server/auth/require-user'
import { createTestAuth } from '../../../support/auth'

let auth: Awaited<ReturnType<typeof createTestAuth>>

beforeAll(async () => {
  auth = await createTestAuth()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetJwtVerifierForTests()
})

function eventWith(headers: Record<string, string>) {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/api/me'
  req.headers = headers
  return createEvent(req, new ServerResponse(req))
}

describe('requireUser', () => {
  it('rejects a request without Authorization', async () => {
    await expect(requireUser(eventWith({}))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('rejects a non-Bearer Authorization scheme', async () => {
    await expect(requireUser(eventWith({ authorization: 'Basic abc' }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('verifies the bearer token and caches the user on the event', async () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    const event = eventWith({ authorization: `Bearer ${await auth.sign({ sub: 'user-9', email: 'n@example.com' })}` })
    const user = await requireUser(event)
    expect(user).toEqual({ userId: 'user-9', email: 'n@example.com', name: null })
    expect(event.context.user).toBe(user)
    await expect(requireUser(event)).resolves.toBe(user)
  })
})
