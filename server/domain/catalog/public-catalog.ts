import { z } from 'zod'

import type { StorefrontCatalog } from '../../../shared/types/catalog'
import { publicSlugSchema, StoreNotFoundError } from '../store/public-store'

// PostgreSQL accepts the full canonical UUID text shape, including deterministic
// fixture IDs that do not encode an RFC version nibble.
const uuidSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
const moneySchema = z.string().regex(/^\d+$/)

const catalogRpcPayloadSchema = z.object({
  store: z.object({
    public_slug: publicSlugSchema,
    name: z.string(),
    description: z.string().nullable(),
    logo_path: z.string().nullable(),
    cover_path: z.string().nullable(),
    timezone: z.string(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  menus: z.array(z.object({
    id: uuidSchema,
    name: z.string(),
  })),
  sections: z.array(z.object({
    id: uuidSchema,
    menu_id: uuidSchema,
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
  })),
  menu_items: z.array(z.object({
    id: uuidSchema,
    menu_id: uuidSchema,
    section_id: uuidSchema,
    product_id: uuidSchema,
  })),
  products: z.array(z.object({
    id: uuidSchema,
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    base_price: moneySchema,
    image_path: z.string().nullable(),
  })),
  option_groups: z.array(z.object({
    id: uuidSchema,
    name: z.string(),
    selection_type: z.enum(['single', 'multiple']),
    required: z.boolean(),
    min_select: z.number().int().nonnegative(),
    max_select: z.number().int().nonnegative(),
    values: z.array(z.object({
      id: uuidSchema,
      name: z.string(),
      price_adjustment: moneySchema,
      is_default: z.boolean(),
    })),
  })),
  product_option_groups: z.array(z.object({
    product_id: uuidSchema,
    option_group_id: uuidSchema,
  })),
})

export type PublicCatalogRpcRow = z.input<typeof catalogRpcPayloadSchema>

export interface PublicCatalogRepository {
  findPublicBySlug: (publicSlug: string) => Promise<PublicCatalogRpcRow | null>
}

export function mapPublicCatalog(source: PublicCatalogRpcRow): StorefrontCatalog {
  const row = catalogRpcPayloadSchema.parse(source)

  return {
    store: {
      publicSlug: row.store.public_slug,
      name: row.store.name,
      description: row.store.description,
      logoPath: row.store.logo_path,
      coverPath: row.store.cover_path,
      timezone: row.store.timezone,
      currency: row.store.currency,
    },
    menus: row.menus.map(menu => ({
      id: menu.id,
      name: menu.name,
    })),
    sections: row.sections.map(section => ({
      id: section.id,
      menuId: section.menu_id,
      name: section.name,
      slug: section.slug,
      description: section.description,
    })),
    menuItems: row.menu_items.map(item => ({
      id: item.id,
      menuId: item.menu_id,
      sectionId: item.section_id,
      productId: item.product_id,
    })),
    products: row.products.map(product => ({
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      basePrice: product.base_price,
      imagePath: product.image_path,
    })),
    optionGroups: row.option_groups.map(group => ({
      id: group.id,
      name: group.name,
      selectionType: group.selection_type,
      required: group.required,
      minSelect: group.min_select,
      maxSelect: group.max_select,
      values: group.values.map(value => ({
        id: value.id,
        name: value.name,
        priceAdjustment: value.price_adjustment,
        isDefault: value.is_default,
      })),
    })),
    productOptionGroups: row.product_option_groups.map(link => ({
      productId: link.product_id,
      optionGroupId: link.option_group_id,
    })),
  }
}

export function createPublicCatalogService(repository: PublicCatalogRepository) {
  return {
    async resolve(publicSlug: string): Promise<StorefrontCatalog> {
      const parsed = publicSlugSchema.safeParse(publicSlug)
      if (!parsed.success) {
        throw new StoreNotFoundError()
      }

      const row = await repository.findPublicBySlug(parsed.data)
      if (!row) {
        throw new StoreNotFoundError()
      }

      return mapPublicCatalog(row)
    },
  }
}
