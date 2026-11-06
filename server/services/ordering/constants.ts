// Spec §5.1 step 2: 10 orders per 10 minutes per ip+store.
import { RATE_POLICIES } from '../../utils/rate-limit-policies'
export const CHECKOUT_RATE_LIMIT = RATE_POLICIES.checkout

export const MAX_PUBLIC_CODE_ATTEMPTS = 5
