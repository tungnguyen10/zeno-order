import type { PaymentAccountDto, SepayIntegrationDto } from '#shared/types/payment'

export type PaymentStep = 'ACCOUNT' | 'CONFIRM_QR' | 'CONNECT_SEPAY' | 'SAVE_SECRET' | 'LINK_ACCOUNT' | 'WAIT_WEBHOOK' | 'ACTIVATE' | 'READY'

export const PAYMENT_STEP_TITLES: Record<PaymentStep, string> = {
  ACCOUNT: 'Thêm tài khoản nhận tiền để bật chuyển khoản',
  CONFIRM_QR: 'Quét mã QR kiểm tra để xác nhận tài khoản',
  CONNECT_SEPAY: 'Kết nối SePay để tự động xác nhận tiền về',
  SAVE_SECRET: 'Dán Secret Key từ SePay',
  LINK_ACCOUNT: 'Liên kết tài khoản với SePay',
  WAIT_WEBHOOK: 'Chờ giao dịch đầu tiên từ SePay',
  ACTIVATE: 'Sẵn sàng bật nhận chuyển khoản',
  READY: 'Sẵn sàng nhận chuyển khoản',
}

export function paymentReadiness(
  account: PaymentAccountDto | null,
  integration: SepayIntegrationDto | null,
): { step: PaymentStep, ready: boolean } {
  if (!account) return { step: 'ACCOUNT', ready: false }
  if (!account.qrCheckedAt) return { step: 'CONFIRM_QR', ready: false }
  if (!integration || integration.environment !== 'live') return { step: 'CONNECT_SEPAY', ready: false }
  if (!integration.hasSecret) return { step: 'SAVE_SECRET', ready: false }
  if (!integration.accountIds.includes(account.id)) return { step: 'LINK_ACCOUNT', ready: false }
  if (integration.status === 'ACTIVE' && account.verifiedAt) return { step: 'READY', ready: true }
  if (integration.lastValidWebhookAt) return { step: 'ACTIVATE', ready: false }
  return { step: 'WAIT_WEBHOOK', ready: false }
}
