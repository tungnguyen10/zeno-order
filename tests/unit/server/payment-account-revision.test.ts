import { describe, expect, it } from 'vitest'
import { paymentAccountRevision } from '../../../server/services/payments/account-revision'

const account = { id: 'account-id', bankCode: 'VCB', accountNumber: '9988776655', vaNumber: null, accountHolder: 'NGUYEN VAN A' }

describe('paymentAccountRevision', () => {
  it('is a stable opaque fingerprint of the recipient details', () => {
    expect(paymentAccountRevision(account)).toMatch(/^[a-f0-9]{64}$/)
    expect(paymentAccountRevision({ ...account })).toBe(paymentAccountRevision(account))
  })

  it.each([
    { id: 'other-account' }, { bankCode: 'ACB' }, { accountNumber: '11223344' },
    { vaNumber: 'VA1234' }, { accountHolder: 'TRAN THI B' },
  ])('changes whenever the preview recipient changes: %o', (patch) => {
    expect(paymentAccountRevision({ ...account, ...patch })).not.toBe(paymentAccountRevision(account))
  })
})
