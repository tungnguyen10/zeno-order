const SENSITIVE_KEY = /phone|address|secret|token|password|authorization|signature|cookie|api[_-]?key|hmac|encryption|jwt|session|credential|private[_-]?key/i
const CONNECTION_STRING = /\b(postgres(?:ql)?):\/\/\S+/gi
const MAX_DEPTH = 6

function redactString(value: string): string {
  return value.replace(CONNECTION_STRING, '$1://[REDACTED]')
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[Truncated]'
  if (typeof value === 'string') return redactString(value)
  if (value instanceof Error) {
    // Drizzle query messages include bound parameters; Postgres messages/details may contain row values.
    const databaseError = value.name === 'DrizzleQueryError' || 'query' in value || 'code' in value || /^Failed query:/i.test(value.message)
    return { name: value.name, message: databaseError ? '[REDACTED database error]' : redactString(value.message) }
  }
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(inner, depth + 1)
    }
    return out
  }
  return value
}

type Level = 'info' | 'warn' | 'error'

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    ...(ctx ? (redact(ctx) as Record<string, unknown>) : {}),
  })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, ctx),
}
