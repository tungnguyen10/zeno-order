import { defineEventHandler, setResponseStatus, type H3Event } from 'h3'
import { toApiError } from './errors'
import { logger } from './logger'

export function defineApiHandler<T>(handler: (event: H3Event) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    }
    catch (err) {
      const { status, body } = toApiError(err)
      if (status >= 500) {
        const cause = err instanceof Error ? err.cause : undefined
        logger.error('api.unhandled', {
          requestId: event.context.requestId,
          path: event.path.split('?')[0],
          err,
          ...(cause === undefined ? {} : { cause }),
        })
      }
      setResponseStatus(event, status)
      return body
    }
  })
}
