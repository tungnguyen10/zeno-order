import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { usePaymentSetup } from '~/composables/usePaymentSetup'
const { api, toast } = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn() }))
mockNuxtImport('useApi', () => () => api)
mockNuxtImport('useToast', () => () => ({ add: toast }))
beforeEach(() => { api.mockReset(); toast.mockReset() })
const integration = { id: 'i1', environment: 'test' }
describe('payment setup orchestration', () => {
  it('ignores test integrations when loading real payment settings', async () => {
    api.mockResolvedValueOnce({ account: null }).mockResolvedValueOnce({ integrations: [integration] })
    const setup = usePaymentSetup({ storeId: 's1', orgId: 'o1' })
    await setup.load()
    expect(setup.integration.value).toBeNull()
  })
  it('serializes owner actions to avoid duplicate integration creation', async () => {
    api.mockResolvedValueOnce({ account: null }).mockResolvedValueOnce({ integrations: [] })
    const setup = usePaymentSetup({ storeId: 's1', orgId: 'o1' })
    await setup.load()
    let release!: (value: unknown) => void
    api.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const first = setup.connect()
    expect(await setup.connect()).toBe(false)
    expect(api).toHaveBeenCalledTimes(3)
    release({ id: 'live', environment: 'live' })
    await first
    expect(setup.busy.value).toBeNull()
  })
  it('does not leave an old check available when checking an edited account fails', async () => {
    api.mockResolvedValueOnce({ account: null }).mockResolvedValueOnce({ integrations: [] })
    const setup = usePaymentSetup({ storeId: 's1', orgId: 'o1' })
    await setup.load()
    setup.check.value = { ok: true, revision: 'revision-1', issues: [], warnings: [], preview: null }
    api.mockRejectedValueOnce({ data: { code: 'VALIDATION_FAILED', message: 'Không hợp lệ', details: [{ path: 'accountNumber', message: 'Kiểm tra số tài khoản' }] } })
    expect(await setup.runCheck({ bankCode: 'VCB', accountNumber: 'bad', accountHolder: 'NAME', vaNumber: null })).toBe(false)
    expect(setup.check.value).toBeNull()
    expect(setup.fieldErrors.value.accountNumber).toBe('Kiểm tra số tài khoản')
    expect(setup.busy.value).toBeNull()
  })
})

it('sends only the revision of the QR preview that was checked', async () => {
  api.mockResolvedValueOnce({ account: { id: 'a1' } }).mockResolvedValueOnce({ integrations: [] })
  const setup = usePaymentSetup({ storeId: 's1', orgId: 'o1' })
  await setup.load()
  expect(await setup.confirm()).toBe(false)
  setup.check.value = { ok: true, revision: 'scanned-revision', issues: [], warnings: [], preview: null }
  api.mockResolvedValueOnce({ id: 'a1', qrCheckedAt: 'now' })
  expect(await setup.confirm()).toBe(true)
  expect(api).toHaveBeenLastCalledWith('/api/stores/s1/payment-accounts/a1/confirm-qr', { method: 'POST', body: { revision: 'scanned-revision' } })
  expect(setup.check.value).toBeNull()
})

it('ignores a delayed response from an older store load', async () => {
  let resolveOld!: (value: unknown) => void
  const old = new Promise(resolve => { resolveOld = resolve })
  api.mockReturnValueOnce(old).mockResolvedValueOnce({ integrations: [] }).mockResolvedValueOnce({ account: { id: 'new' } }).mockResolvedValueOnce({ integrations: [] })
  const storeId = ref('old')
  const setup = usePaymentSetup({ storeId, orgId: 'o1' })
  const first = setup.load()
  storeId.value = 'new'
  await setup.load()
  resolveOld({ account: { id: 'old' } })
  await first
  expect(setup.account.value?.id).toBe('new')
})
