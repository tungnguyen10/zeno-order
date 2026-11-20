import { describe, expect, it } from 'vitest'
import { sanitizeAnalyticsLocation, sanitizeAnalyticsPath } from '../../../app/utils/analytics-path'

describe('sanitizeAnalyticsPath', () => {
  it('redacts the guest tracking token', () => {
    expect(sanitizeAnalyticsPath('/o/secret-guest-token')).toBe('/o/:token')
    expect(sanitizeAnalyticsPath('/o/secret-guest-token?x=1')).toBe('/o/:token')
    expect(sanitizeAnalyticsPath('/o')).toBe('/o')
  })

  it('redacts the invitation token', () => {
    expect(sanitizeAnalyticsPath('/invite/abc123def')).toBe('/invite/:token')
  })

  it('drops the query string so the ?t= table token never leaks', () => {
    expect(sanitizeAnalyticsPath('/s/tra-sua-may?t=table-secret')).toBe('/s/tra-sua-may')
    expect(sanitizeAnalyticsPath('/s/tra-sua-may')).toBe('/s/tra-sua-may')
  })

  it('drops a hash fragment', () => {
    expect(sanitizeAnalyticsPath('/app/orders#section')).toBe('/app/orders')
  })

  it('keeps non-secret paths as-is', () => {
    expect(sanitizeAnalyticsPath('/app/orders')).toBe('/app/orders')
    expect(sanitizeAnalyticsPath('/login')).toBe('/login')
    expect(sanitizeAnalyticsPath('/')).toBe('/')
  })

  it('normalises a trailing slash but preserves root', () => {
    expect(sanitizeAnalyticsPath('/app/menu/')).toBe('/app/menu')
    expect(sanitizeAnalyticsPath('/')).toBe('/')
  })

  it('does not treat a lookalike path as a token route', () => {
    expect(sanitizeAnalyticsPath('/orders')).toBe('/orders')
    expect(sanitizeAnalyticsPath('/invitego')).toBe('/invitego')
  })
})

describe('sanitizeAnalyticsLocation', () => {
  it('joins the base URL with the sanitized path and trims extra slashes', () => {
    expect(sanitizeAnalyticsLocation('https://zeno.app', '/o/secret?t=1')).toBe('https://zeno.app/o/:token')
    expect(sanitizeAnalyticsLocation('https://zeno.app/', '/s/quan?t=secret')).toBe('https://zeno.app/s/quan')
  })
})
