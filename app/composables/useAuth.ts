export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export class AuthFailure extends Error {}

type AuthErrorLike = { code?: string, message?: string } | null | undefined

// @neon/auth throws AuthApiError (Better Auth body in `.error`) on non-2xx instead of returning `{ error }`.
async function runAuthAction(action: () => Promise<{ error?: AuthErrorLike }>): Promise<void> {
  let result: { error?: AuthErrorLike }
  try {
    result = await action()
  }
  catch (err) {
    throw new AuthFailure(translateAuthError((err as { error?: AuthErrorLike } | null)?.error))
  }
  if (result.error) throw new AuthFailure(translateAuthError(result.error))
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
