import { decodeJwtExp } from './auth-token'

type TokenResult = { data?: { token?: string } | null }

export interface SessionTokenClient {
  getSession: () => Promise<{ data?: { session?: { token?: string } | null } | null }>
  /** GET /token bypassing @neon/auth's session cache (X-Force-Fetch). */
  forceFetchToken: () => Promise<TokenResult>
}

// @neon/auth caches getSession with `session.token` replaced by the JWT from the `set-auth-jwt` header
// (and answers any `/token` URL from that cache), so the JWT is read from the session. If the header
// was not visible, `session.token` is the opaque session token and /token is fetched directly instead.
export function createSessionTokenSource(client: SessionTokenClient): () => Promise<TokenResult> {
  return async () => {
    try {
      const { data } = await client.getSession()
      const token = data?.session?.token
      if (!data?.session) return { data: null }
      if (token && decodeJwtExp(token) !== null) return { data: { token } }
      const forced = await client.forceFetchToken()
      return { data: forced.data?.token ? { token: forced.data.token } : null }
    }
    catch (err) {
      if ((err as { status?: number } | null)?.status === 401) return { data: null }
      throw err
    }
  }
}
