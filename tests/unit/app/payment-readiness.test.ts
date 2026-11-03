import { describe, expect, it } from 'vitest'
import type { PaymentAccountDto, SepayIntegrationDto } from '#shared/types/payment'
import { PAYMENT_STEP_TITLES, paymentReadiness } from '../../../app/utils/payment-readiness'

const account = (over: Partial<PaymentAccountDto> = {}): PaymentAccountDto => ({
  id: 'acc-1', bankCode: 'VCB', bankName: 'Vietcombank', accountNumber: '9988776655', vaNumber: null,
  accountHolder: 'NGUYEN VAN A', qrCheckedAt: '2026-11-01T05:00:00.000Z', verifiedAt: null, linkedIntegrationId: null, ...over,
})
const integration = (over: Partial<SepayIntegrationDto> = {}): SepayIntegrationDto => ({
  id: 'int-1', name: 'SePay', environment: 'live', status: 'DRAFT', hasSecret: false, hasApiToken: false,
  secretUpdatedAt: null, lastValidWebhookAt: null, updatedAt: '2026-11-01T05:00:00.000Z', webhookUrl: 'https://x/api/webhooks/sepay/k', accountIds: [], ...over,
})

describe('paymentReadiness', () => {
  it('walks through the steps in order', () => {
    expect(paymentReadiness(null, null).step).toBe('ACCOUNT')
    expect(paymentReadiness(account({ qrCheckedAt: null }), null).step).toBe('CONFIRM_QR')
    expect(paymentReadiness(account(), null).step).toBe('CONNECT_SEPAY')
    expect(paymentReadiness(account(), integration()).step).toBe('SAVE_SECRET')
    expect(paymentReadiness(account(), integration({ hasSecret: true, status: 'TESTING' })).step).toBe('LINK_ACCOUNT')
    expect(paymentReadiness(account(), integration({ hasSecret: true, status: 'TESTING', accountIds: ['acc-1'] })).step).toBe('WAIT_WEBHOOK')
    expect(paymentReadiness(account(), integration({ hasSecret: true, status: 'TESTING', accountIds: ['acc-1'], lastValidWebhookAt: '2026-11-01T06:00:00.000Z' })).step).toBe('ACTIVATE')
  })

  it('is ready only with an ACTIVE integration and a verified account', () => {
    const active = integration({ hasSecret: true, status: 'ACTIVE', accountIds: ['acc-1'], lastValidWebhookAt: '2026-11-01T06:00:00.000Z' })
    expect(paymentReadiness(account({ verifiedAt: '2026-11-01T06:01:00.000Z' }), active)).toEqual({ step: 'READY', ready: true })
    expect(paymentReadiness(account(), active).ready).toBe(false)
  })

  it('falls back to the QR check when the owner edited the account after going live', () => {
    const active = integration({ hasSecret: true, status: 'ACTIVE', accountIds: ['acc-1'], lastValidWebhookAt: '2026-11-01T06:00:00.000Z' })
    expect(paymentReadiness(account({ qrCheckedAt: null, verifiedAt: null }), active)).toEqual({ step: 'CONFIRM_QR', ready: false })
  })

  it('never marks a test integration ready for real customer payments', () => {
    expect(paymentReadiness(account({ verifiedAt: '2026-11-01T06:01:00.000Z' }), integration({ environment: 'test', hasSecret: true, status: 'ACTIVE', accountIds: ['acc-1'] })).ready).toBe(false)
  })

  it('has a Vietnamese title for every step', () => {
    for (const title of Object.values(PAYMENT_STEP_TITLES)) expect(title.length).toBeGreaterThan(5)
    expect(Object.keys(PAYMENT_STEP_TITLES)).toHaveLength(8)
  })
})
