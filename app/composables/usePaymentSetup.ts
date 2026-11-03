import type { MaybeRefOrGetter } from 'vue'
import type { PaymentAccountCheck, PaymentAccountDto, SepayIntegrationDto } from '#shared/types/payment'

export interface PaymentAccountDraft {
  bankCode: string
  accountNumber: string
  accountHolder: string
  vaNumber: string | null
}

type Busy = 'check' | 'confirm' | 'connect' | 'secret' | 'link' | 'activate'

export function usePaymentSetup(ids: { storeId: MaybeRefOrGetter<string>, orgId: MaybeRefOrGetter<string> }) {
  const api = useApi()
  const toast = useToast()

  const account = ref<PaymentAccountDto | null>(null)
  const integration = ref<SepayIntegrationDto | null>(null)
  const check = ref<PaymentAccountCheck | null>(null)
  const loading = ref(true)
  const loadFailed = ref(false)
  const busy = ref<Busy | null>(null)
  const fieldErrors = ref<Record<string, string>>({})

  const storePath = () => `/api/stores/${toValue(ids.storeId)}/payment-accounts`
  const orgPath = () => `/api/organizations/${toValue(ids.orgId)}/sepay-integrations`

  async function reloadAccount() {
    account.value = (await api<{ account: PaymentAccountDto | null }>(storePath())).account
  }

  let loadVersion = 0
  async function load() {
    if (busy.value) return
    const version = ++loadVersion
    const store = storePath()
    const org = orgPath()
    loading.value = true
    loadFailed.value = false
    try {
      const [accountRes, integrationRes] = await Promise.all([
        api<{ account: PaymentAccountDto | null }>(store),
        api<{ integrations: SepayIntegrationDto[] }>(org),
      ])
      if (version !== loadVersion || store !== storePath() || org !== orgPath()) return
      account.value = accountRes.account
      integration.value = integrationRes.integrations.find(i => i.environment === 'live') ?? null
      check.value = null
    }
    catch {
      if (version === loadVersion) loadFailed.value = true
    }
    finally {
      if (version === loadVersion) loading.value = false
    }
  }

  async function guarded(kind: Busy, action: () => Promise<void>, success?: string): Promise<boolean> {
    if (busy.value || loading.value) return false
    busy.value = kind
    fieldErrors.value = {}
    try {
      await action()
      if (success) toast.add({ color: 'success', title: success })
      return true
    }
    catch (err) {
      const apiError = extractApiError(err)
      if (apiError.code === 'VALIDATION_FAILED' && Array.isArray(apiError.details)) {
        fieldErrors.value = Object.fromEntries((apiError.details as { path: string, message: string }[]).map(d => [d.path, d.message]))
      }
      toast.add({ color: 'error', title: apiError.message })
      return false
    }
    finally {
      busy.value = null
    }
  }

  const runCheck = (draft: PaymentAccountDraft) => guarded('check', async () => {
    check.value = null
    const saved = account.value
      ? await api<PaymentAccountDto>(`${storePath()}/${account.value.id}`, { method: 'PATCH', body: draft })
      : await api<PaymentAccountDto>(storePath(), { method: 'POST', body: draft })
    account.value = saved
    check.value = await api<PaymentAccountCheck>(`${storePath()}/${saved.id}/check`, { method: 'POST' })
  })

  function confirm() {
    const current = account.value
    const revision = check.value?.revision
    if (!current || !check.value?.ok || !revision) return Promise.resolve(false)
    return guarded('confirm', async () => {
      account.value = await api<PaymentAccountDto>(`${storePath()}/${current.id}/confirm-qr`, { method: 'POST', body: { revision } })
      check.value = null
    }, 'Đã xác nhận tài khoản nhận tiền')
  }

  const connect = () => guarded('connect', async () => {
    integration.value = await api<SepayIntegrationDto>(orgPath(), { method: 'POST', body: {} })
  })

  const link = () => guarded('link', async () => {
    if (!integration.value || !account.value) return
    integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/accounts`, {
      method: 'POST',
      body: { paymentAccountId: account.value.id },
    })
    await reloadAccount()
  })

  const saveSecret = (input: { hmacSecret: string, apiToken?: string }) => guarded('secret', async () => {
    if (!integration.value) return
    integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/secret`, { method: 'PUT', body: input })
    const current = account.value
    if (current && !integration.value.accountIds.includes(current.id)) {
      integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/accounts`, {
        method: 'POST',
        body: { paymentAccountId: current.id },
      })
      await reloadAccount()
    }
  }, 'Đã lưu Secret Key')

  const activate = () => guarded('activate', async () => {
    if (!integration.value) return
    integration.value = await api<SepayIntegrationDto>(`${orgPath()}/${integration.value.id}/activate`, { method: 'POST' })
    await reloadAccount()
  }, 'Đã bật nhận chuyển khoản')

  return { account, integration, check, loading, loadFailed, busy, fieldErrors, load, runCheck, confirm, connect, link, saveSecret, activate }
}
