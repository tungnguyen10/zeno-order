import { defineEventHandler, setResponseHeaders } from 'h3'
import { securityHeaders } from '../utils/security-headers'

export default defineEventHandler((event) => {
  // Development needs HMR; the production harness tests the enforced policy.
  if (process.env.NODE_ENV !== 'production') return
  setResponseHeaders(event, securityHeaders(event.path.split('?')[0]!))
})
