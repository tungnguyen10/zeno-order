import { bankManualInputSchema } from '#shared/schemas/reconciliation'
import { requireStoreOwner, requireStoreStaff  } from '../../../../../auth/guards'
import { markOrderPaidBankManual } from '../../../../../services/payments/manual-payments'
import { parseWith, parseBody  } from '../../../../../utils/validation'
import { getRouterParam, readBody, setHeader } from 'h3'
import { markPaidSchema } from '#shared/schemas/orders'
import { getDb } from '../../../../../db/client'
import { recordCashPayment } from '../../../../../services/ordering/record-cash-payment'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const raw: unknown = await readBody(event)
  if (raw && typeof raw === 'object' && 'method' in raw && raw.method === 'BANK_MANUAL') {
    const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
    return markOrderPaidBankManual(getDb(), ctx, { orderId: requireUuidParam(event, 'orderId'), ...parseWith(bankManualInputSchema, raw) })
  }
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  const body = await parseBody(event, markPaidSchema)
  return recordCashPayment(getDb(), ctx, { orderId, expectedPaymentStatus: body.expectedPaymentStatus, note: body.note })
})
