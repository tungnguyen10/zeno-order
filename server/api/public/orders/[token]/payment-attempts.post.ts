import { getRouterParam, setHeader, setResponseStatus } from 'h3'
import { getDb } from '../../../../db/client'
import { createReplacementAttempt, findOrderRefByGuestToken } from '../../../../services/payments/attempts'
import { REPAY_RATE_LIMIT } from '../../../../services/payments/constants'
import { consumeRateLimit } from '../../../../services/ordering/rate-limit'
import { defineApiHandler } from '../../../../utils/api-handler'
import { AppError } from '../../../../utils/errors'

export default defineApiHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')
  const db = getDb()
  const ref = await findOrderRefByGuestToken(db, getRouterParam(event, 'token') ?? '')
  if (!ref) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  if (!(await consumeRateLimit(db, `repay:${ref.orderId}`, REPAY_RATE_LIMIT))) {
    throw new AppError('RATE_LIMITED', 'Bạn thao tác quá nhanh, vui lòng thử lại sau')
  }
  const { qr, created } = await createReplacementAttempt(db, ref)
  setResponseStatus(event, created ? 201 : 200)
  return { qr }
})
