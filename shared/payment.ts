export const SEPAY_ENVIRONMENTS = ['test', 'live'] as const
export const SEPAY_INTEGRATION_STATUSES = ['DRAFT', 'TESTING', 'ACTIVE', 'DISABLED'] as const
export const PAYMENT_ATTEMPT_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'SUPERSEDED'] as const

export type SepayEnvironment = (typeof SEPAY_ENVIRONMENTS)[number]
export type SepayIntegrationStatus = (typeof SEPAY_INTEGRATION_STATUSES)[number]
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number]

/** Amount of the throw-away QR the owner scans to confirm the account (VND). */
export const PAYMENT_PREVIEW_AMOUNT_VND = 2000
