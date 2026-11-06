import type { Resolution } from '#shared/payments'
import type { OverdueOrder, ReconciliationSummary, RefundDueOrder, ReviewItem } from '#shared/types/reconciliation'

export function useReconciliation() {
  const api = useApi()
  const { activeStore } = useActiveStore()

  function base(): string {
    if (!activeStore.value) throw new Error('Chưa chọn cửa hàng')
    return `/api/stores/${activeStore.value.id}`
  }

  return {
    summary: () => api<ReconciliationSummary>(`${base()}/reconciliation/summary`),
    listReview: (status: 'REVIEW_REQUIRED' | 'RESOLVED') =>
      api<{ items: ReviewItem[] }>(`${base()}/reconciliation`, { query: { status } }),
    listRefunds: () => api<{ items: RefundDueOrder[] }>(`${base()}/reconciliation/refunds`),
    listOverdue: () => api<{ items: OverdueOrder[] }>(`${base()}/reconciliation/overdue`),
    assign: (transactionId: string, orderId: string, acceptAmountDifference: boolean) =>
      api(`${base()}/reconciliation/${transactionId}/assign`, { method: 'POST', body: { orderId, acceptAmountDifference } }),
    resolve: (transactionId: string, resolution: Resolution, note?: string) =>
      api(`${base()}/reconciliation/${transactionId}/resolve`, { method: 'POST', body: { resolution, note } }),
    markRefunded: (orderId: string, note: string, expectedHeldVnd: number) =>
      api(`${base()}/orders/${orderId}/refunded`, { method: 'POST', body: { note, expectedHeldVnd } }),
    markPaidManually: (orderId: string, expectedPaymentStatus: OverdueOrder['paymentStatus'], note: string) =>
      api(`${base()}/orders/${orderId}/mark-paid`, { method: 'POST', body: { method: 'BANK_MANUAL', expectedPaymentStatus, note } }),
  }
}

export function useReconciliationBadge() {
  const { activeStore } = useActiveStore()
  const reconciliation = useReconciliation()
  const count = useState<number>('reconciliation:badge', () => 0)
  const isOwner = computed(() => activeStore.value?.role === 'OWNER')

  async function refresh(): Promise<void> {
    const storeId = activeStore.value?.id
    if (!isOwner.value) {
      count.value = 0
      return
    }
    try {
      const summary = await reconciliation.summary()
      if (activeStore.value?.id !== storeId || !isOwner.value) return
      count.value = summary.reviewCount + summary.refundDueCount
    }
    catch {
      // The badge is best-effort; the page itself reports errors.
    }
  }

  return { count, isOwner, refresh }
}
