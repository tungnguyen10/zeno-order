import type { VerifiedUser } from '../auth/jwt'

declare module 'h3' {
  interface H3EventContext {
    requestId: string
    user?: VerifiedUser
  }
}
