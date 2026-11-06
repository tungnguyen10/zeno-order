import { defineEventHandler } from 'h3'
import { logger } from '../utils/logger'
import { logPath } from '../utils/log-path'

export default defineEventHandler((event) => {
  const start = performance.now()
  event.node.res.once('finish', () => {
    logger.info('http.request', {
      method: event.method,
      path: logPath(event.path),
      status: event.node.res.statusCode,
      durationMs: Math.round(performance.now() - start),
    })
  })
})
