import { defineEventHandler, setResponseStatus, type H3Event } from 'h3'
import { toApiError } from './errors'

export function defineApiHandler<T>(handler: (event: H3Event) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    }
    catch (err) {
      const { status, body } = toApiError(err)
      if (status >= 500) {
        console.error('api.unhandled', event.path)
      }
      setResponseStatus(event, status)
      return body
    }
  })
}
