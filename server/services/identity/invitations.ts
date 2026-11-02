import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { maskEmail } from '#shared/email'
import type { AcceptInvitationResult, InvitationPreview } from '#shared/types/team'
import type { VerifiedUser } from '../../auth/jwt'
import type { Db, DbOrTx } from '../../db/client'
import { organizations, storeInvitations, storeMembers, stores } from '../../db/schema'
import { findStoreAccess } from '../../repositories/membership'
import { AppError } from '../../utils/errors'
import { hashToken } from '../../utils/tokens'
import { ensureProfile } from './profile'

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const notFound = () => new AppError('NOT_FOUND', 'Lời mời không còn hiệu lực')

const openInvitation = (token: string) => and(
  eq(storeInvitations.tokenHash, hashToken(token)),
  isNull(storeInvitations.acceptedAt),
  gt(storeInvitations.expiresAt, sql`now()`),
  eq(stores.status, 'ACTIVE'),
  eq(organizations.status, 'ACTIVE'),
)

const invitationColumns = {
  id: storeInvitations.id,
  orgId: storeInvitations.orgId,
  storeId: storeInvitations.storeId,
  email: storeInvitations.email,
  role: storeInvitations.role,
  expiresAt: storeInvitations.expiresAt,
  storeName: stores.name,
  storeSlug: stores.slug,
  isAcceptingOrders: stores.isAcceptingOrders,
}

export async function previewInvitation(db: DbOrTx, user: VerifiedUser, token: string): Promise<InvitationPreview> {
  if (!TOKEN_SHAPE.test(token)) throw notFound()
  const [inv] = await db
    .select(invitationColumns)
    .from(storeInvitations)
    .innerJoin(stores, and(eq(stores.id, storeInvitations.storeId), eq(stores.orgId, storeInvitations.orgId)))
    .innerJoin(organizations, eq(organizations.id, storeInvitations.orgId))
    .where(openInvitation(token))
    .limit(1)
  if (!inv) throw notFound()
  return {
    storeName: inv.storeName,
    role: inv.role,
    emailHint: maskEmail(inv.email),
    expiresAt: inv.expiresAt.toISOString(),
    emailMatches: user.email?.trim().toLowerCase() === inv.email,
    emailVerified: user.emailVerified === true,
  }
}

export async function acceptInvitation(
  db: Db,
  user: VerifiedUser,
  token: string,
  opts: { requireVerifiedEmail: boolean },
): Promise<AcceptInvitationResult> {
  if (!TOKEN_SHAPE.test(token)) throw notFound()
  return db.transaction(async (tx) => {
    // Quy ước xuyên PR #7: mọi luồng tạo membership đều ensureProfile trong cùng transaction.
    const profile = await ensureProfile(tx, user)

    const [inv] = await tx
      .select(invitationColumns)
      .from(storeInvitations)
      .innerJoin(stores, and(eq(stores.id, storeInvitations.storeId), eq(stores.orgId, storeInvitations.orgId)))
      .innerJoin(organizations, eq(organizations.id, storeInvitations.orgId))
      .where(openInvitation(token))
      .limit(1)
      // Khóa dòng lời mời: hai accept đồng thời xếp hàng, người sau thấy accepted_at đã có và nhận 404.
      .for('update', { of: storeInvitations })
    if (!inv) throw notFound()

    if (profile.email !== inv.email) {
      throw new AppError('FORBIDDEN', 'Email của bạn không khớp với lời mời', { reason: 'EMAIL_MISMATCH' })
    }
    if (opts.requireVerifiedEmail && user.emailVerified !== true) {
      throw new AppError('FORBIDDEN', 'Bạn cần xác minh email trước khi tham gia', { reason: 'EMAIL_NOT_VERIFIED' })
    }

    const [existing] = await tx
      .select({ id: storeMembers.id, status: storeMembers.status })
      .from(storeMembers)
      .where(and(eq(storeMembers.orgId, inv.orgId), eq(storeMembers.storeId, inv.storeId), eq(storeMembers.userId, profile.userId)))
      .limit(1)
    if (!existing) {
      await tx.insert(storeMembers).values({ orgId: inv.orgId, storeId: inv.storeId, userId: profile.userId, role: inv.role })
    }
    else if (existing.status === 'DISABLED') {
      await tx.update(storeMembers).set({ status: 'ACTIVE', updatedAt: new Date() }).where(and(eq(storeMembers.id, existing.id), eq(storeMembers.orgId, inv.orgId), eq(storeMembers.storeId, inv.storeId)))
    }

    await tx
      .update(storeInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: profile.userId })
      .where(and(eq(storeInvitations.id, inv.id), eq(storeInvitations.orgId, inv.orgId), eq(storeInvitations.storeId, inv.storeId)))

    const access = await findStoreAccess(tx, profile.userId, inv.storeId)
    if (!access) throw notFound()

    return {
      store: {
        id: inv.storeId,
        orgId: inv.orgId,
        name: inv.storeName,
        slug: inv.storeSlug,
        role: access.role,
        isAcceptingOrders: inv.isAcceptingOrders,
      },
    }
  })
}
