import { getQuery, readBody, type H3Event } from 'h3'
import type { z } from 'zod'
import { AppError, zodIssues } from './errors'

export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', zodIssues(result.error))
  }
  return result.data
}

export async function parseBody<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  let raw: unknown
  try {
    raw = await readBody(event)
  }
  catch {
    throw new AppError('VALIDATION_FAILED', 'Body JSON không hợp lệ')
  }
  return parseWith(schema, raw)
}

export function parseQuery<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  return parseWith(schema, getQuery(event))
}
