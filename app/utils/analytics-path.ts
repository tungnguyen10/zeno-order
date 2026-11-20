// Route segments that carry an unguessable secret in the URL. GA must never receive the real value,
// so these are collapsed to a placeholder before any page_view is sent.
const SECRET_PREFIXES: { prefix: string, redacted: string }[] = [
  { prefix: '/o/', redacted: '/o/:token' },
  { prefix: '/invite/', redacted: '/invite/:token' },
]

/**
 * Turns a router path (which may include a query string) into a safe GA page_path:
 * redacts guest/invite tokens, drops the query entirely (e.g. the `?t=` table token),
 * and normalises a trailing slash. Pure and side-effect free.
 */
export function sanitizeAnalyticsPath(fullPath: string): string {
  const path = fullPath.split(/[?#]/)[0] || '/'
  for (const { prefix, redacted } of SECRET_PREFIXES) {
    // Only redact when a token segment actually follows (e.g. /o/<token>), not the bare prefix.
    if (path.startsWith(prefix) && path.length > prefix.length) return redacted
  }
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path
}

/** Builds an absolute, token-free page_location from the app's base URL and a sanitized path. */
export function sanitizeAnalyticsLocation(baseUrl: string, fullPath: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${sanitizeAnalyticsPath(fullPath)}`
}
