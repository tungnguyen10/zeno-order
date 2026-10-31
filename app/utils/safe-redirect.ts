import { hasProtocol } from 'ufo'

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\s\u0000-\u001F\u007F]/

export function safeRedirect(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  if (UNSAFE_CHARS.test(value) || hasProtocol(value, { acceptRelative: true })) return fallback
  return value
}
