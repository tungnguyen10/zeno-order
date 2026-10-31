import { translateAuthError } from './auth-errors'

type AuthErrorLike = { code?: string, message?: string } | null | undefined

export class AuthFailure extends Error {}

// @neon/auth throws AuthApiError (Better Auth body in `.error`) on non-2xx instead of returning `{ error }`.
export async function runAuthAction(action: () => Promise<{ error?: AuthErrorLike }>): Promise<void> {
  let result: { error?: AuthErrorLike }
  try {
    result = await action()
  }
  catch (err) {
    throw new AuthFailure(translateAuthError((err as { error?: AuthErrorLike } | null)?.error), { cause: err })
  }
  if (result.error) throw new AuthFailure(translateAuthError(result.error), { cause: result.error })
}
