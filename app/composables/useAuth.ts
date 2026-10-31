export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export function useAuth() {
  const { $authClient, $tokenCache } = useNuxtApp()
  const user = useState<SessionUser | null>('auth:user', () => null)
  const ready = useState<boolean>('auth:ready', () => false)

  // @neon/auth only refreshes its session cache from responses that carry `session`; email sign-in/up
  // responses don't, so after switching accounts the cache must be bypassed or it keeps the old user.
  async function refresh(force = false): Promise<SessionUser | null> {
    const { data } = await $authClient.getSession(force ? { fetchOptions: { headers: { 'X-Force-Fetch': 'true' } } } : undefined)
    user.value = data?.user
      ? { id: data.user.id, email: data.user.email, name: data.user.name ?? null }
      : null
    ready.value = true
    return user.value
  }

  /** Drops every client-side trace of the current user (token, session user, cached /api/me). */
  function clearLocalSession(): void {
    $tokenCache.clear()
    user.value = null
    clearNuxtState(['me'])
  }

  async function signIn(email: string, password: string): Promise<void> {
    await runAuthAction(() => $authClient.signIn.email({ email, password }))
    clearLocalSession()
    await refresh(true)
  }

  async function signUp(name: string, email: string, password: string): Promise<void> {
    await runAuthAction(() => $authClient.signUp.email({ name, email, password }))
    clearLocalSession()
    await refresh(true)
  }

  async function signOut(): Promise<void> {
    try {
      await $authClient.signOut()
    }
    finally {
      clearLocalSession()
    }
  }

  return { user, ready, refresh, signIn, signUp, signOut, clearLocalSession }
}
