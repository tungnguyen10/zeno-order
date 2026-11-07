import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvent } from 'h3'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { clientIp } from '../../../server/utils/client-ip'
import { logPath } from '../../../server/utils/log-path'
import { securityHeaders } from '../../../server/utils/security-headers'
import { requireOps } from '../../../server/utils/ops-auth'
import { evaluateStatus, type OpsSnapshot } from '../../../server/services/ops/health-policy'
import { getJwtVerifier, resetJwtVerifierForTests } from '../../../server/auth/jwt'

function event(headers: Record<string, string> = {}) {
  return createEvent({ headers, socket: { remoteAddress: '127.0.0.1' }, url: '/', method: 'GET' } as IncomingMessage, {} as ServerResponse)
}
afterEach(() => { vi.unstubAllEnvs(); resetJwtVerifierForTests() })
describe('trusted ingress IP', () => {
  it('ignores forged forwarding headers outside a trusted ingress', () => {
    vi.stubEnv('VERCEL', ''); vi.stubEnv('TRUST_FORWARDED_FOR', '')
    expect(clientIp(event({ 'x-forwarded-for': '8.8.8.8', 'x-vercel-forwarded-for': '9.9.9.9' }))).toBe('127.0.0.1')
  })
  it('uses only the Vercel-overwritten header on Vercel', () => {
    vi.stubEnv('VERCEL', '1')
    expect(clientIp(event({ 'x-forwarded-for': '8.8.8.8', 'x-vercel-forwarded-for': '9.9.9.9' }))).toBe('9.9.9.9')
    expect(clientIp(event({ 'x-vercel-forwarded-for': 'invalid' }))).toBe('127.0.0.1')
  })
  it('requires explicit opt-in for another overwriting proxy', () => {
    vi.stubEnv('VERCEL', ''); vi.stubEnv('TRUST_FORWARDED_FOR', '1')
    expect(clientIp(event({ 'x-forwarded-for': '2001:db8::1, 127.0.0.1' }))).toBe('2001:db8::1')
  })
})
describe('access paths', () => {
  it.each(['/o/secret?t=table-secret', '/api/public/orders/secret', '/api/webhooks/sepay/secret', '/invite/secret', '/api/invitations/secret/accept', '/s/secret?phone=0912345678', '/api/unknown/secret', '/api/public/orders/menu'])('keeps credentials and queries out of %s', (path) => {
    expect(logPath(path)).not.toMatch(/secret|0912345678|\?/)
  })
  it('preserves method-independent route shapes without raw IDs', () => {
    expect(logPath('/api/stores/uuid/orders/uuid/status')).toBe('/api/stores/:id/orders/:id/status')
  })
})
describe('security baseline', () => {
  it('allows configured auth, storage and VietQR while denying frames/eval', () => {
    const headers = securityHeaders('/api/public/orders/token', { NODE_ENV: 'production', NEON_AUTH_BASE_URL: 'https://auth.example/neondb/auth', AWS_ENDPOINT_URL_S3: 'https://storage.example' })
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['Content-Security-Policy']).toContain('https://auth.example')
    expect(headers['Content-Security-Policy']).toContain('https://storage.example')
    expect(headers['Content-Security-Policy']).toContain('https://qr.sepay.vn')
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'")
    expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval')
  })
  it('does not interpolate malicious env into CSP', () => {
    expect(securityHeaders('/', { NEON_AUTH_BASE_URL: 'javascript:alert(1); script-src *' })['Content-Security-Policy']).not.toContain('javascript:')
  })
  it('fails closed for missing/short ops secrets and rejects user cookies', () => {
    vi.stubEnv('OPS_STATUS_SECRET', '')
    expect(() => requireOps(event())).toThrow()
    vi.stubEnv('OPS_STATUS_SECRET', 'x'.repeat(32))
    expect(() => requireOps(event({ cookie: 'session=owner' }))).toThrow()
    expect(() => requireOps(event({ authorization: `Bearer ${'x'.repeat(32)}` }))).not.toThrow()
    expect(() => requireOps(event({ authorization: `Bearer ${'y'.repeat(32)}` }))).toThrow()
  })
  it.each([{ NODE_ENV: 'production', NEON_BRANCH: '' }, { NODE_ENV: 'development', NEON_BRANCH: 'production' }])('rejects test JWKS on a real production target %j', (env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubEnv('ZENO_TEST_DB', ''); vi.stubEnv('AUTH_TEST_JWKS', '{}')
    expect(() => getJwtVerifier()).toThrow('AUTH_TEST_JWKS must not be set in production')
  })
})
const now = new Date('2026-11-06T12:00:00Z')
const healthy = (): OpsSnapshot => ({ jobsEnabled: true, jobs: ['expire', 'reconcile'].map(job => ({ job, lastSucceededAt: now, lastError: null })), checkpoints: [{ lastSyncedAt: now, lastError: null }], stuckTransactions: 0, overdueAttempts: 0, pendingReview: 2, manualIntegrations: 1 })
describe('operations health policy', () => {
  it('reports manual reconciliation/review without pretending a bank test passed', () => {
    expect(evaluateStatus(healthy(), now)).toMatchObject({ ok: true, counts: { manualIntegrations: 1, pendingReview: 2 } })
  })
  it('does not hide a dead integration behind a healthy global checkpoint', () => {
    const snapshot = healthy(); snapshot.checkpoints.push({ lastSyncedAt: null, lastError: null })
    expect(evaluateStatus(snapshot, now)).toMatchObject({ ok: false, reasons: ['INTEGRATION_STALE'] })
  })
  it('detects a stopped scheduler even without pending orders', () => {
    const snapshot = healthy(); snapshot.jobs = []
    expect(evaluateStatus(snapshot, now).reasons).toEqual(['EXPIRE_STALE', 'RECONCILE_STALE'])
  })
  it('detects stale successes, last-run failures, disabled jobs and backlog', () => {
    const snapshot = healthy(); snapshot.jobsEnabled = false; snapshot.jobs[0]!.lastSucceededAt = new Date(0); snapshot.jobs[1]!.lastError = 'JOB_FAILED'; snapshot.overdueAttempts = 1; snapshot.stuckTransactions = 1
    expect(evaluateStatus(snapshot, now).reasons).toEqual(['JOBS_DISABLED', 'EXPIRE_STALE', 'RECONCILE_STALE', 'TRANSACTIONS_STUCK', 'ATTEMPTS_OVERDUE'])
  })
})
