import { sql } from 'drizzle-orm'
import type { VerifiedUser } from '../../auth/jwt'
import type { DbOrTx } from '../../db/client'
import { userProfiles } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { logger } from '../../utils/logger'

export async function ensureProfile(db: DbOrTx, user: VerifiedUser) {
  if (!user.email) {
    logger.warn('auth.missing_email_claim', { userId: user.userId })
    throw new AppError('UNAUTHENTICATED', 'Tài khoản chưa có email')
  }
  const email = user.email.trim().toLowerCase()
  const [row] = await db
    .insert(userProfiles)
    .values({ userId: user.userId, email, displayName: user.name })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        email,
        displayName: sql`coalesce(excluded.display_name, ${userProfiles.displayName})`,
        updatedAt: new Date(),
      },
    })
    .returning({ userId: userProfiles.userId, email: userProfiles.email, displayName: userProfiles.displayName })
  return row!
}
