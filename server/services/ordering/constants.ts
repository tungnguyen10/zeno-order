// Spec §5.1 step 2: 10 orders per 10 minutes per ip+store.
export const CHECKOUT_RATE_LIMIT = { limit: 10, windowSec: 600 } as const

export const MAX_PUBLIC_CODE_ATTEMPTS = 5
