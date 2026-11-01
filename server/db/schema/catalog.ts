import { sql } from 'drizzle-orm'
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { stores, timestamps } from './identity'

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, t => [
  unique('categories_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'categories_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  index('categories_store_position_idx').on(t.storeId, t.position),
])

export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  // Nullable on purpose: quick add creates a product before any category exists (MATCH SIMPLE skips the FK when null).
  categoryId: uuid('category_id'),
  name: text('name').notNull(),
  description: text('description'),
  basePriceVnd: bigint('base_price_vnd', { mode: 'number' }).notNull(),
  isAvailable: boolean('is_available').notNull().default(true),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  imageKey: text('image_key'),
  ...timestamps,
}, t => [
  unique('products_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'products_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'products_category_fk', columns: [t.storeId, t.categoryId], foreignColumns: [categories.storeId, categories.id] }),
  check('products_base_price_nonneg', sql`${t.basePriceVnd} >= 0`),
  index('products_store_position_idx').on(t.storeId, t.position),
])

export const productOptionGroups = pgTable('product_option_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  productId: uuid('product_id').notNull(),
  name: text('name').notNull(),
  minSelect: integer('min_select').notNull().default(0),
  maxSelect: integer('max_select').notNull().default(1),
  required: boolean('required').notNull().default(false),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, t => [
  unique('product_option_groups_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'option_groups_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'option_groups_product_fk', columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete('cascade'),
  check('option_groups_min_max_valid', sql`${t.minSelect} >= 0 and ${t.maxSelect} >= ${t.minSelect}`),
  index('option_groups_product_idx').on(t.storeId, t.productId),
])

export const productOptionValues = pgTable('product_option_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  groupId: uuid('group_id').notNull(),
  name: text('name').notNull(),
  priceDeltaVnd: bigint('price_delta_vnd', { mode: 'number' }).notNull().default(0),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, t => [
  unique('product_option_values_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'option_values_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  foreignKey({ name: 'option_values_group_fk', columns: [t.storeId, t.groupId], foreignColumns: [productOptionGroups.storeId, productOptionGroups.id] }).onDelete('cascade'),
  check('option_values_price_delta_nonneg', sql`${t.priceDeltaVnd} >= 0`),
  index('option_values_group_idx').on(t.storeId, t.groupId),
])

export const storeTables = pgTable('store_tables', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  code: text('code').notNull(),
  displayName: text('display_name').notNull(),
  tokenHash: text('token_hash').notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
}, t => [
  unique('store_tables_store_id_id_uq').on(t.storeId, t.id),
  unique('store_tables_store_code_uq').on(t.storeId, t.code),
  unique('store_tables_token_hash_uq').on(t.tokenHash),
  foreignKey({ name: 'store_tables_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
])

export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  name: text('name').notNull(),
  feeVnd: bigint('fee_vnd', { mode: 'number' }).notNull(),
  active: boolean('active').notNull().default(true),
  position: integer('position').notNull().default(0),
  ...timestamps,
}, t => [
  unique('delivery_zones_store_id_id_uq').on(t.storeId, t.id),
  foreignKey({ name: 'delivery_zones_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  check('delivery_zones_fee_nonneg', sql`${t.feeVnd} >= 0`),
  index('delivery_zones_store_idx').on(t.storeId, t.position),
])
