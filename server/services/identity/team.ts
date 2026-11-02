import { and, asc, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { INVITATION_TTL_DAYS } from '#shared/schemas/team'
import type { CreatedInvitation, TeamInvitation, TeamResponse } from '#shared/types/team'
import type { StoreContext } from '../../auth/guards'
import type { Db, DbOrTx } from '../../db/client'
import { organizationMembers, storeInvitations, storeMembers, userProfiles } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { generateToken, hashToken } from '../../utils/tokens'

type InvitationRow = Pick<typeof storeInvitations.$inferSelect, 'id' | 'email' | 'expiresAt' | 'createdAt'>

function toInvitation(row: InvitationRow, now = Date.now()): TeamInvitation {
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= now,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listTeam(db: DbOrTx, ctx: StoreContext): Promise<TeamResponse> {
  const [orgOwners, staff, invitations] = await Promise.all([
    db
      .select({ userId: userProfiles.userId, email: userProfiles.email, displayName: userProfiles.displayName })
      .from(organizationMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, organizationMembers.userId))
      .where(and(eq(organizationMembers.orgId, ctx.orgId), eq(organizationMembers.status, 'ACTIVE'), eq(organizationMembers.role, 'OWNER')))
      .orderBy(asc(organizationMembers.createdAt)),
    db
      .select({
        userId: userProfiles.userId,
        email: userProfiles.email,
        displayName: userProfiles.displayName,
        role: storeMembers.role,
        status: storeMembers.status,
      })
      .from(storeMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, storeMembers.userId))
      .where(and(eq(storeMembers.orgId, ctx.orgId), eq(storeMembers.storeId, ctx.storeId)))
      .orderBy(asc(storeMembers.createdAt)),
    db
      .select({ id: storeInvitations.id, email: storeInvitations.email, expiresAt: storeInvitations.expiresAt, createdAt: storeInvitations.createdAt })
      .from(storeInvitations)
      .where(and(eq(storeInvitations.orgId, ctx.orgId), eq(storeInvitations.storeId, ctx.storeId), isNull(storeInvitations.acceptedAt)))
      .orderBy(desc(storeInvitations.createdAt)),
  ])

  const ownerIds = new Set(orgOwners.map(owner => owner.userId))
  return {
    members: [
      ...orgOwners.map(owner => ({
        ...owner,
        role: 'OWNER' as const,
        status: 'ACTIVE' as const,
        source: 'ORG' as const,
        isSelf: owner.userId === ctx.userId,
        canDisable: false,
      })),
      ...staff
        .filter(member => !ownerIds.has(member.userId))
        .map(member => ({ ...member, source: 'STORE' as const, isSelf: member.userId === ctx.userId, canDisable: member.userId !== ctx.userId })),
    ],
    invitations: invitations.map(row => toInvitation(row)),
  }
}

export async function setMemberStatus(db: Db, ctx: StoreContext, targetUserId: string, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
  if (targetUserId === ctx.userId) {
    throw new AppError('VALIDATION_FAILED', 'Bạn không thể tự khóa tài khoản của mình', { reason: 'SELF' })
  }
  const [row] = await db
    .update(storeMembers)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(storeMembers.orgId, ctx.orgId), eq(storeMembers.storeId, ctx.storeId), eq(storeMembers.userId, targetUserId)))
    .returning({ userId: storeMembers.userId })
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
}

export async function createInvitation(db: Db, ctx: StoreContext, input: { email: string }, baseUrl: string): Promise<CreatedInvitation> {
  const email = input.email.trim().toLowerCase()
  const token = generateToken()
  return db.transaction(async (tx) => {
    // Serialize theo (store, email): hai request đồng thời không để lại hai link sống.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invite:${ctx.storeId}:${email}`}))`)

    const [member] = await tx
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .leftJoin(storeMembers, and(eq(storeMembers.userId, userProfiles.userId), eq(storeMembers.orgId, ctx.orgId), eq(storeMembers.storeId, ctx.storeId), eq(storeMembers.status, 'ACTIVE')))
      .leftJoin(organizationMembers, and(eq(organizationMembers.userId, userProfiles.userId), eq(organizationMembers.orgId, ctx.orgId), eq(organizationMembers.status, 'ACTIVE')))
      .where(and(eq(userProfiles.email, email), or(isNotNull(storeMembers.id), isNotNull(organizationMembers.id))))
      .limit(1)
    if (member) {
      throw new AppError('VALIDATION_FAILED', 'Người này đã là thành viên của cửa hàng', { field: 'email', reason: 'ALREADY_MEMBER' })
    }

    await tx
      .delete(storeInvitations)
      .where(and(eq(storeInvitations.orgId, ctx.orgId), eq(storeInvitations.storeId, ctx.storeId), eq(storeInvitations.email, email), isNull(storeInvitations.acceptedAt)))

    const [row] = await tx
      .insert(storeInvitations)
      .values({
        orgId: ctx.orgId,
        storeId: ctx.storeId,
        email,
        role: 'STAFF',
        tokenHash: hashToken(token),
        expiresAt: sql`now() + make_interval(days => ${INVITATION_TTL_DAYS})`,
        createdBy: ctx.userId,
      })
      .returning({ id: storeInvitations.id, email: storeInvitations.email, expiresAt: storeInvitations.expiresAt, createdAt: storeInvitations.createdAt })
    return { invitation: toInvitation(row!), inviteUrl: `${baseUrl}/invite/${token}` }
  })
}

export async function revokeInvitation(db: Db, ctx: StoreContext, invitationId: string): Promise<void> {
  const [row] = await db
    .delete(storeInvitations)
    .where(and(
      eq(storeInvitations.id, invitationId),
      eq(storeInvitations.orgId, ctx.orgId),
      eq(storeInvitations.storeId, ctx.storeId),
      isNull(storeInvitations.acceptedAt),
    ))
    .returning({ id: storeInvitations.id })
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
}
