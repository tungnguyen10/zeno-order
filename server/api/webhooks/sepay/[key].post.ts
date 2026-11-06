import { clientIp } from '../../../utils/client-ip'
import { readWebhookBody } from '../../../utils/webhook-body'
import { getHeader, getRouterParam, setHeader } from 'h3'
import { getDb, type Db } from '../../../db/client'
import { loadIntegrationSecrets, findIntegrationByEndpointKey } from '../../../services/payments/integration-secrets'
import { runWebhookProcessing } from '../../../services/payments/process-sepay-webhook'
import { sepayWebhookPayloadSchema } from '../../../services/payments/sepay-payload'
import { authenticateWebhook } from '../../../services/payments/webhook-auth'
import { getWebhookAuthMode, touchVerifiedWebhook } from '../../../services/payments/webhook-auth-settings'
import { allowWebhookFailure, allowWebhookTraffic } from '../../../services/payments/webhook-traffic'
import { defineApiHandler } from '../../../utils/api-handler'
import { AppError } from '../../../utils/errors'
import { logger } from '../../../utils/logger'
import { parseWith } from '../../../utils/validation'

const MAX_BODY_BYTES = 64 * 1024

// Failed attempts are throttled per IP so the endpoint key and credentials cannot be brute-forced.
async function reject(db: Db, ip: string, error: AppError): Promise<never> {
  if (!(await allowWebhookFailure(db, ip))) throw new AppError('RATE_LIMITED', 'Quá nhiều yêu cầu')
  throw error
}

export default defineApiHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const db = getDb()
  const ip = clientIp(event)
  if (!(await allowWebhookTraffic(db, ip))) throw new AppError('RATE_LIMITED', 'Quá nhiều yêu cầu')

  const integration = await findIntegrationByEndpointKey(db, getRouterParam(event, 'key') ?? '')
  const secrets = integration ? await loadIntegrationSecrets(db, integration.id) : null
  if (!integration || !secrets?.hmacSecret) return reject(db, ip, new AppError('NOT_FOUND', 'Không tìm thấy'))

  const rawBody = await readWebhookBody(event, MAX_BODY_BYTES)
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) throw new AppError('VALIDATION_FAILED', 'Yêu cầu quá lớn')

  const mode = await getWebhookAuthMode(db, integration.id)
  const auth = authenticateWebhook({
    mode,
    secret: secrets.hmacSecret,
    rawBody,
    nowSec: Math.floor(Date.now() / 1000),
    headers: {
      authorization: getHeader(event, 'authorization'),
      signature: getHeader(event, 'x-sepay-signature'),
      timestamp: getHeader(event, 'x-sepay-timestamp'),
    },
  })
  if (auth !== 'OK') {
    logger.warn('webhook.auth_failed', { integrationId: integration.id, mode, reason: auth })
    return reject(db, ip, new AppError('UNAUTHENTICATED', 'Xác thực webhook thất bại'))
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  }
  catch {
    throw new AppError('VALIDATION_FAILED', 'Body JSON không hợp lệ')
  }
  const payload = parseWith(sepayWebhookPayloadSchema, json)

  await touchVerifiedWebhook(db, integration.id).catch(() => {
    logger.warn('webhook.touch_failed', { integrationId: integration.id })
  })

  await runWebhookProcessing(db, { integration: { id: integration.id, orgId: integration.orgId }, payload })
  return { success: true }
})
