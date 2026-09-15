interface TrackingStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

interface ConsumeTrackingTokenInput {
  publicSlug: string
  orderNumber: string
  hash: string
  pathname: string
  search: string
  storage: TrackingStorage
  replaceUrl: (url: string) => void
}

const tokenPattern = /^[A-Za-z0-9_-]{43}$/

export function trackingSessionKey(publicSlug: string, orderNumber: string) {
  return `zeno-order:tracking:v1:${publicSlug}:${orderNumber}`
}

export function consumeTrackingToken(input: ConsumeTrackingTokenInput): string | null {
  const key = trackingSessionKey(input.publicSlug, input.orderNumber)
  const fragmentToken = new URLSearchParams(input.hash.replace(/^#/, '')).get('t')
  if (input.hash) input.replaceUrl(`${input.pathname}${input.search}`)

  if (fragmentToken && tokenPattern.test(fragmentToken)) {
    input.storage.setItem(key, fragmentToken)
    return fragmentToken
  }

  const stored = input.storage.getItem(key)
  return stored && tokenPattern.test(stored) ? stored : null
}
