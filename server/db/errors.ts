interface PgLikeError {
  code?: unknown
  constraint?: unknown
  cause?: unknown
}

export function getPgError(err: unknown): { code?: string, constraint?: string } {
  let current: unknown = err
  for (let i = 0; i < 3 && current && typeof current === 'object'; i++) {
    const candidate = current as PgLikeError
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      }
    }
    current = candidate.cause
  }
  return {}
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = getPgError(err)
  return pg.code === '23505' && (constraint === undefined || pg.constraint === constraint)
}
