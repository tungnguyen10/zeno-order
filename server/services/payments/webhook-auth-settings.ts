import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db, DbOrTx } from '../../db/client'
import { sepayIntegrations, sepayWebhookAuth } from '../../db/schema'
import { AppError } from '../../utils/errors'

export async function getWebhookAuthMode(db: DbOrTx, integrationId: string): Promise<'HMAC' | 'APIKEY'> {
  const [row] = await db.select({ mode: sepayWebhookAuth.mode }).from(sepayWebhookAuth).where(eq(sepayWebhookAuth.integrationId, integrationId))
  return row?.mode ?? 'HMAC'
}

export async function setWebhookAuthMode(db: Db, orgId: string, integrationId: string, mode: 'HMAC' | 'APIKEY'): Promise<void> {
  if (!z.uuid().safeParse(integrationId).success) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  await db.transaction(async (tx) => {
    const [owned] = await tx.select().from(sepayIntegrations)
      .where(and(eq(sepayIntegrations.id, integrationId), eq(sepayIntegrations.orgId, orgId))).for('update')
    if (!owned) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    if (owned.status === 'DISABLED') throw new AppError('STATUS_CONFLICT', 'Kết nối đã tắt')
    const current = await getWebhookAuthMode(tx, integrationId)
    if (current === mode) return
    await tx.insert(sepayWebhookAuth).values({ integrationId, mode })
      .onConflictDoUpdate({ target: sepayWebhookAuth.integrationId, set: { mode } })
    // A successful delivery in the old mode does not verify the new credential/mode.
    await tx.update(sepayIntegrations).set({ lastValidWebhookAt: null, status: owned.status === 'ACTIVE' ? 'TESTING' : owned.status }).where(eq(sepayIntegrations.id, integrationId))
  })
}

// PR5's activateIntegration needs one verified delivery before TESTING can become ACTIVE.
// Throttled to one write a minute: a busy store would otherwise write on every webhook.
export async function touchVerifiedWebhook(db: Db, integrationId: string): Promise<void> {
  await db.update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(and(
    eq(sepayIntegrations.id, integrationId),
    sql`(${sepayIntegrations.lastValidWebhookAt} is null or ${sepayIntegrations.lastValidWebhookAt} < now() - interval '1 minute')`,
  ))
}
