import { randomUUID } from 'node:crypto'
import { defineEventHandler, setResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  // Caller-controlled IDs can contain guest/webhook capabilities and later enter error logs.
  const requestId = randomUUID()
  event.context.requestId = requestId
  setResponseHeader(event, 'x-request-id', requestId)
})
