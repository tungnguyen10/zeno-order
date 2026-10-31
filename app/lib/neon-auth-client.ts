import { createAuthClient } from '@neon/auth'

export function createNeonAuthClient(baseUrl: string) {
  return createAuthClient(baseUrl)
}

export type NeonAuthClient = ReturnType<typeof createNeonAuthClient>
