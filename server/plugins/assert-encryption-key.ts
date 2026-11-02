import { assertEncryptionKey } from '../utils/crypto'

// Crash on boot rather than at the first checkout, so a bad deploy is caught by the platform health check.
export default defineNitroPlugin(() => {
  assertEncryptionKey()
})
