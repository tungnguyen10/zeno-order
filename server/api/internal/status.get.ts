import { setResponseHeader, setResponseStatus } from 'h3'
import { getDb } from '../../db/client'
import { getOpsStatus } from '../../services/ops/status'
import { defineApiHandler } from '../../utils/api-handler'
import { AppError } from '../../utils/errors'
import { requireOps } from '../../utils/ops-auth'

export default defineApiHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  requireOps(event)
  try {
    const result = await getOpsStatus(getDb())
    if (!result.ok) setResponseStatus(event, 503)
    return result
  }
  catch { throw new AppError('SERVICE_UNAVAILABLE', 'Không đọc được trạng thái vận hành') }
})
