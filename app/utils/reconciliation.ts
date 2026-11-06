import type { ReviewReason } from '#shared/payments'

export type AmountComparison = { kind: 'EXACT' } | { kind: 'UNDER' | 'OVER', diffVnd: number }

export function compareAmount(receivedVnd: number, expectedVnd: number): AmountComparison {
  if (receivedVnd === expectedVnd) return { kind: 'EXACT' }
  return receivedVnd < expectedVnd
    ? { kind: 'UNDER', diffVnd: expectedVnd - receivedVnd }
    : { kind: 'OVER', diffVnd: receivedVnd - expectedVnd }
}

export function reasonStatus(reason: ReviewReason | null): 'warning' | 'error' | 'info' {
  if (reason === 'ORDER_CANCELLED' || reason === 'ORDER_ALREADY_PAID') return 'error'
  if (reason === 'AMOUNT_UNDER' || reason === 'AMOUNT_OVER') return 'warning'
  return 'info'
}
