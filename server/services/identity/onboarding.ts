import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { OnboardingInput } from '#shared/schemas/identity'
import type { OrganizationSummary, StoreSummary } from '#shared/types/identity'
import type { VerifiedUser } from '../../auth/jwt'
import type { Db } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { organizationMembers, organizations, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { ensureProfile } from './profile'

export async function createOrganizationWithStore(
  db: Db,
  user: VerifiedUser,
  input: OnboardingInput,
): Promise<{ organization: OrganizationSummary, store: StoreSummary }> {
  try {
    return await db.transaction(async (tx) => {
      await ensureProfile(tx, user)
      // Serialize onboarding per user so a double submit cannot create two orgs.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`onboarding:${user.userId}`}))`)

      const existing = await tx
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, user.userId))
        .limit(1)
      if (existing.length > 0) throw new AppError('ORG_EXISTS', 'Bạn đã có tổ chức')

      const [org] = await tx
        .insert(organizations)
        .values({ name: input.orgName, slug: `${input.storeSlug}-${randomBytes(3).toString('hex')}` })
        .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug })
      await tx.insert(organizationMembers).values({ orgId: org!.id, userId: user.userId, role: 'OWNER' })
      const [store] = await tx
        .insert(stores)
        .values({ orgId: org!.id, name: input.storeName, slug: input.storeSlug })
        .returning()

      return {
        organization: { ...org!, role: 'OWNER' as const },
        store: {
          id: store!.id,
          orgId: store!.orgId,
          name: store!.name,
          slug: store!.slug,
          isAcceptingOrders: store!.isAcceptingOrders,
          role: 'OWNER' as const,
        },
      }
    })
  }
  catch (err) {
    if (isUniqueViolation(err, 'stores_slug_unique')) {
      throw new AppError('SLUG_TAKEN', 'Đường dẫn cửa hàng đã được dùng', { field: 'storeSlug' })
    }
    throw err
  }
}
