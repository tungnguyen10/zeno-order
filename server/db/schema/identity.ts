import { boolean, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export const orgRole = pgEnum('org_role', ['OWNER'])
export const storeRole = pgEnum('store_role', ['OWNER', 'STAFF'])
export const memberStatus = pgEnum('member_status', ['ACTIVE', 'DISABLED'])
export const entityStatus = pgEnum('entity_status', ['ACTIVE', 'SUSPENDED'])

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}

export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  ...timestamps,
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: entityStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
})

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => userProfiles.userId),
  role: orgRole('role').notNull(),
  status: memberStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
}, t => [
  unique('organization_members_org_user_uq').on(t.orgId, t.userId),
  index('organization_members_user_idx').on(t.userId),
])

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: entityStatus('status').notNull().default('ACTIVE'),
  isAcceptingOrders: boolean('is_accepting_orders').notNull().default(false),
  dineInEnabled: boolean('dine_in_enabled').notNull().default(true),
  pickupEnabled: boolean('pickup_enabled').notNull().default(true),
  deliveryEnabled: boolean('delivery_enabled').notNull().default(false),
  logoKey: text('logo_key'),
  paymentTtlMinutes: integer('payment_ttl_minutes').notNull().default(15),
  ...timestamps,
}, t => [
  unique('stores_org_id_id_uq').on(t.orgId, t.id),
  index('stores_org_idx').on(t.orgId),
])

export const storeMembers = pgTable('store_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  userId: text('user_id').notNull().references(() => userProfiles.userId),
  role: storeRole('role').notNull(),
  status: memberStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
}, t => [
  unique('store_members_store_user_uq').on(t.storeId, t.userId),
  foreignKey({ name: 'store_members_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  index('store_members_user_idx').on(t.userId),
])

export const storeInvitations = pgTable('store_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  email: text('email').notNull(),
  role: storeRole('role').notNull().default('STAFF'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: text('accepted_by').references(() => userProfiles.userId),
  createdBy: text('created_by').notNull().references(() => userProfiles.userId),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: 'store_invitations_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  index('store_invitations_store_idx').on(t.storeId),
])
