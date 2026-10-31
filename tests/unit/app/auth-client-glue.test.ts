import { describe, expect, it, vi } from 'vitest'
import { AuthFailure, runAuthAction } from '../../../app/utils/auth-action'
import { createSessionTokenSource } from '../../../app/utils/auth-session-token'

function fakeJwt(exp: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA' })}.${encode({ sub: 'u', exp })}.sig`
}

describe('createSessionTokenSource', () => {
  it('returns the JWT from a warm (cached) session without hitting /token', async () => {
    const jwt = fakeJwt(5000)
    const forceFetchToken = vi.fn()
    const source = createSessionTokenSource({
      getSession: async () => ({ data: { session: { token: jwt }, user: { id: 'u' } } }),
      forceFetchToken,
    })
    expect(await source()).toEqual({ data: { token: jwt } })
    expect(forceFetchToken).not.toHaveBeenCalled()
  })

  it('force-fetches /token when session.token is not a JWT', async () => {
    const jwt = fakeJwt(5000)
    const source = createSessionTokenSource({
      getSession: async () => ({ data: { session: { token: 'opaque-session-token' } } }),
      forceFetchToken: async () => ({ data: { token: jwt } }),
    })
    expect(await source()).toEqual({ data: { token: jwt } })
  })

  it('returns null when signed out', async () => {
    const forceFetchToken = vi.fn()
    const source = createSessionTokenSource({ getSession: async () => ({ data: null }), forceFetchToken })
    expect(await source()).toEqual({ data: null })
    expect(forceFetchToken).not.toHaveBeenCalled()
  })

  it('maps a thrown 401 to null', async () => {
    const source = createSessionTokenSource({
      getSession: async () => ({ data: { session: { token: 'opaque' } } }),
      forceFetchToken: async () => {
        throw Object.assign(new Error('Unauthorized'), { status: 401 })
      },
    })
    expect(await source()).toEqual({ data: null })
  })

  it('rethrows non-401 failures', async () => {
    const failure = Object.assign(new Error('Service unavailable'), { status: 503 })
    const source = createSessionTokenSource({
      getSession: async () => {
        throw failure
      },
      forceFetchToken: vi.fn(),
    })
    await expect(source()).rejects.toBe(failure)
  })
})

describe('runAuthAction', () => {
  it('translates a thrown AuthApiError-shaped error and keeps the cause', async () => {
    const thrown = { status: 401, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
    const promise = runAuthAction(async () => {
      throw thrown
    })
    await expect(promise).rejects.toBeInstanceOf(AuthFailure)
    await expect(promise).rejects.toMatchObject({ message: 'Email hoặc mật khẩu không đúng', cause: thrown })
  })

  it('translates a returned { error }', async () => {
    const promise = runAuthAction(async () => ({ error: { code: 'USER_ALREADY_EXISTS' } }))
    await expect(promise).rejects.toBeInstanceOf(AuthFailure)
    await expect(promise).rejects.toThrow('Email này đã được đăng ký')
  })

  it('uses the generic message for unknown errors', async () => {
    await expect(runAuthAction(async () => {
      throw new TypeError('Failed to fetch')
    })).rejects.toThrow('Có lỗi xảy ra, vui lòng thử lại')
  })

  it('resolves when the action succeeds', async () => {
    await expect(runAuthAction(async () => ({ error: null }))).resolves.toBeUndefined()
  })
})
