export function createCheckoutAttemptManager(createUuid: () => string = () => crypto.randomUUID()) {
  let fingerprint: string | null = null
  let idempotencyKey: string | null = null

  return {
    keyFor(nextFingerprint: string) {
      if (fingerprint !== nextFingerprint || !idempotencyKey) {
        fingerprint = nextFingerprint
        idempotencyKey = createUuid()
      }
      return idempotencyKey
    },
    reset() {
      fingerprint = null
      idempotencyKey = null
    },
  }
}
