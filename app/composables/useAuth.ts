export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export function useAuth() {
  const { $authClient, $tokenCache } = useNuxtApp()
  const user = useState<SessionUser | null>('auth:user', () => null)
  const ready = useState<boolean>('auth:ready', () => false)

  async function refresh(): Promise<SessionUser | null> {
    const { data } = await $authClient.getSession()
    user.value = data?.user
      ? { id: data.user.id, email: data.user.email, name: data.user.name ?? null }
      : null
    ready.value = true
    return user.value
  }

  async function signIn(email: string, password: string): Promise<void> {
    await runAuthAction(() => $authClient.signIn.email({ email, password }))
    $tokenCache.clear()
    await refresh()
  }

  async function signUp(name: string, email: string, password: string): Promise<void> {
    await runAuthAction(() => $authClient.signUp.email({ name, email, password }))
    $tokenCache.clear()
    await refresh()
  }

  async function signOut(): Promise<void> {
    try {
      await $authClient.signOut()
    }
    finally {
      $tokenCache.clear()
      user.value = null
      clearNuxtState(['me'])
    }
  }

  return { user, ready, refresh, signIn, signUp, signOut }
}
