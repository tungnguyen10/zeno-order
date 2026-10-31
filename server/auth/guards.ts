import type { H3Event } from 'h3'
import { z } from 'zod'
import { getDb } from '../db/client'
import { findOrgAccess, findStoreAccess, type StoreAccess } from '../repositories/membership'
import { AppError } from '../utils/errors'
import { requireUser } from './require-user'

export interface StoreContext extends StoreAccess {
  userId: string
}

const uuid = z.uuid()

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Không tìm thấy')
}

export async function requireStoreStaff(event: H3Event, storeId: string | undefined): Promise<StoreContext> {
  const user = await requireUser(event)
  if (!storeId || !uuid.safeParse(storeId).success) throw notFound()
  const access = await findStoreAccess(getDb(), user.userId, storeId)
  if (!access) throw notFound()
  return { ...access, userId: user.userId }
}

export async function requireStoreOwner(event: H3Event, storeId: string | undefined): Promise<StoreContext> {
  const context = await requireStoreStaff(event, storeId)
  if (context.role !== 'OWNER') {
    throw new AppError('FORBIDDEN', 'Chỉ chủ cửa hàng được thực hiện thao tác này')
  }
  return context
}

export async function requireOrgOwner(event: H3Event, orgId: string | undefined): Promise<{ orgId: string, userId: string }> {
  const user = await requireUser(event)
  if (!orgId || !uuid.safeParse(orgId).success) throw notFound()
  const access = await findOrgAccess(getDb(), user.userId, orgId)
  if (!access) throw notFound()
  return { orgId: access.orgId, userId: user.userId }
}
