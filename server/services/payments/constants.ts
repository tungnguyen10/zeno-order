/** Version of APP_ENCRYPTION_KEY used for sepay_integrations.key_version (matches the `v1.` blob prefix). */
export const PAYMENT_SECRET_KEY_VERSION = 1

export const MAX_PAYMENT_CODE_ATTEMPTS = 5

/** Customer "Tạo mã mới": 10 calls per order per 10 minutes. */
export const REPAY_RATE_LIMIT = { limit: 10, windowSec: 600 } as const
