import { getRouterParam, type H3Event } from 'h3'
import { z } from 'zod'
import { AppError } from './errors'

const uuid = z.uuid()

/** A malformed id is indistinguishable from a missing resource: 404, never 400/500. */
export function requireUuidParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value || !uuid.safeParse(value).success) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return value
}
