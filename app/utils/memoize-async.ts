/** Calls `loader` at most once at a time and caches its result; a rejection is not cached so the next call retries. */
export function memoizeAsync<T>(loader: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= loader().catch((err: unknown) => {
      pending = null
      throw err
    })
    return pending
  }
}
