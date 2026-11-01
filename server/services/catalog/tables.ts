import { and, asc, eq, sql } from 'drizzle-orm'
import type { CreateTableInput, UpdateTableInput } from '#shared/schemas/tables'
import type { TableDTO, TableWithQr } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { Db, DbOrTx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { storeTables, stores } from '../../db/schema'
import { inStore, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { generateToken, hashToken } from '../../utils/tokens'

export interface ResolvedTable {
  id: string
  code: string
  displayName: string
}

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')
const MAX_TOKEN_LENGTH = 200

export function nextTableCode(existing: string[]): string {
  const numeric = existing.filter(code => /^\d+$/.test(code)).map(Number)
  const next = numeric.length === 0 ? 1 : Math.max(...numeric) + 1
  return String(next).padStart(2, '0')
}

export function buildTableQrUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/s/${slug}?t=${token}`
}

function toDTO(row: typeof storeTables.$inferSelect): TableDTO {
  return { id: row.id, code: row.code, displayName: row.displayName, active: row.active }
}

async function storeSlug(db: DbOrTx, ctx: StoreContext): Promise<string> {
  const [row] = await db.select({ slug: stores.slug }).from(stores).where(and(eq(stores.id, ctx.storeId), eq(stores.orgId, ctx.orgId))).limit(1)
  if (!row) throw notFound()
  return row.slug
}

export async function listTables(db: DbOrTx, scope: CatalogScope): Promise<TableDTO[]> {
  const rows = await db
    .select()
    .from(storeTables)
    .where(inStore(storeTables, scope))
    .orderBy(asc(storeTables.createdAt), asc(storeTables.code))
  return rows.map(toDTO)
}

export async function createTable(db: Db, ctx: StoreContext, input: CreateTableInput, baseUrl: string): Promise<TableWithQr> {
  const slug = await storeSlug(db, ctx)
  const token = generateToken()
  try {
    const row = await db.transaction(async (tx) => {
      // Serialises auto-numbering per store so concurrent "add table" taps get distinct codes.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tables:${ctx.storeId}`}))`)
      const code = input.code ?? nextTableCode((await tx.select({ code: storeTables.code }).from(storeTables).where(inStore(storeTables, ctx))).map(r => r.code))
      const [created] = await tx
        .insert(storeTables)
        .values({
          orgId: ctx.orgId,
          storeId: ctx.storeId,
          code,
          displayName: input.displayName ?? `Bàn ${code}`,
          tokenHash: hashToken(token),
        })
        .returning()
      return created!
    })
    return { ...toDTO(row), qrUrl: buildTableQrUrl(baseUrl, slug, token) }
  }
  catch (err) {
    if (isUniqueViolation(err, 'store_tables_store_code_uq')) {
      throw new AppError('VALIDATION_FAILED', 'Mã bàn đã tồn tại', [{ path: 'code', message: 'Mã bàn đã tồn tại' }])
    }
    throw err
  }
}

export async function regenerateTable(db: DbOrTx, ctx: StoreContext, tableId: string, baseUrl: string): Promise<TableWithQr> {
  const slug = await storeSlug(db, ctx)
  const token = generateToken()
  const [row] = await db
    .update(storeTables)
    .set({ tokenHash: hashToken(token), active: true, updatedAt: new Date() })
    .where(and(eq(storeTables.id, tableId), inStore(storeTables, ctx)))
    .returning()
  if (!row) throw notFound()
  return { ...toDTO(row), qrUrl: buildTableQrUrl(baseUrl, slug, token) }
}

export async function updateTable(db: DbOrTx, ctx: StoreContext, tableId: string, patch: UpdateTableInput): Promise<TableDTO> {
  const [row] = await db
    .update(storeTables)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(storeTables.id, tableId), inStore(storeTables, ctx)))
    .returning()
  if (!row) throw notFound()
  return toDTO(row)
}

export async function resolveActiveTable(db: DbOrTx, storeId: string, token: string): Promise<ResolvedTable | null> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null
  const [row] = await db
    .select({ id: storeTables.id, code: storeTables.code, displayName: storeTables.displayName })
    .from(storeTables)
    .where(and(eq(storeTables.storeId, storeId), eq(storeTables.tokenHash, hashToken(token)), eq(storeTables.active, true)))
    .limit(1)
  return row ?? null
}
