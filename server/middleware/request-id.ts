import { randomUUID } from 'node:crypto'
import { defineEventHandler, getHeader, setResponseHeader } from 'h3'

const VALID_ID = /^[\w-]{8,64}$/

export default defineEventHandler((event) => {
  const incoming = getHeader(event, 'x-request-id')
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID()
  event.context.requestId = requestId
  setResponseHeader(event, 'x-request-id', requestId)
})
