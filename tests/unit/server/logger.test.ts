import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger, redact } from '../../../server/utils/logger'

describe('redact', () => {
  it('masks sensitive keys at any depth, keeps the rest', () => {
    expect(redact({
      customerPhone: '0901234567',
      nested: { address: '1 Lê Lợi', ok: 1 },
      token: 'abc',
      list: [{ hmacSecret: 's' }, { name: 'Lan' }],
    })).toEqual({
      customerPhone: '[REDACTED]',
      nested: { address: '[REDACTED]', ok: 1 },
      token: '[REDACTED]',
      list: [{ hmacSecret: '[REDACTED]' }, { name: 'Lan' }],
    })
  })

  it.each([
    'encryptionKey',
    'jwt',
    'sessionId',
    'credentials',
    'privateKey',
    'private_key',
    'private-key',
  ])('masks %s', (key) => {
    expect(redact({ [key]: 'v', name: 'ok' })).toEqual({ [key]: '[REDACTED]', name: 'ok' })
  })

  it('masks postgres connection strings inside strings', () => {
    expect(redact('failed: postgresql://u:p@h/db?sslmode=require')).toBe('failed: postgresql://[REDACTED]')
  })

  it('serializes errors to name + redacted message', () => {
    expect(redact(new Error('boom postgres://a:b@c/d'))).toEqual({ name: 'Error', message: 'boom postgres://[REDACTED]' })
  })

  it('does not log database query parameters or PostgreSQL error details', () => {
    const query = new Error('Failed query: insert into orders values ($1)\nparams: 0912345678,12 Lê Lợi,v1.ciphertext')
    query.name = 'DrizzleQueryError'
    expect(redact(query)).toEqual({ name: 'DrizzleQueryError', message: '[REDACTED database error]' })
    const cause = Object.assign(new Error('duplicate key'), { code: '23505', detail: 'Key (phone)=(0912345678) already exists' })
    expect(redact(cause)).toEqual({ name: 'Error', message: '[REDACTED database error]' })
  })

  it('truncates very deep structures', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]')
  })
})

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes one JSON line with level, msg and redacted context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('order.created', { orderId: 'o1', customerPhone: '0901234567' })
    const line = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(line).toMatchObject({ level: 'info', msg: 'order.created', orderId: 'o1', customerPhone: '[REDACTED]' })
    expect(typeof line.time).toBe('string')
  })

  it('writes errors to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('x', { err: new Error('bad') })
    expect(JSON.parse(spy.mock.calls[0]![0] as string)).toMatchObject({ level: 'error', err: { message: 'bad' } })
  })
})
