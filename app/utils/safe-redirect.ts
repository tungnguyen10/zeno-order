export function safeRedirect(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
