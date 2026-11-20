import { foreignKey, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { stores, timestamps, userProfiles } from './identity'

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  userId: text('user_id').notNull().references(() => userProfiles.userId),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  ...timestamps,
}, t => [
  // One row per browser push endpoint; re-subscribing updates the owning store/user.
  unique('push_subscriptions_endpoint_uq').on(t.endpoint),
  foreignKey({ name: 'push_subscriptions_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  index('push_subscriptions_store_idx').on(t.storeId),
])
