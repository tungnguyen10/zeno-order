import { and, desc, eq, exists, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { ZodError } from 'zod'
import { findBank } from '../../../shared/banks'
import { PAYMENT_PREVIEW_AMOUNT_VND } from '../../../shared/payment'
import { paymentAccountInputSchema, type PaymentAccountInput, type PaymentAccountPatch } from '../../../shared/schemas/payment'
import type { PaymentAccountCheck, PaymentAccountDto, PaymentAccountField, PaymentAccountIssue } from '../../../shared/types/payment'
import type { StoreContext } from '../../auth/guards'
import type { Db, DbOrTx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { integrationAccounts, sepayIntegrations, storePaymentAccounts } from '../../db/schema'
import { AppError, zodIssues } from '../../utils/errors'
import { parseWith } from '../../utils/validation'
import { paymentAccountRevision } from './account-revision'
import { buildTransferContent, buildVietQrUrl, PAYMENT_TEST_CODE } from './payment-code'

type AccountRow = typeof storePaymentAccounts.$inferSelect

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

const scope = (ctx: StoreContext) => and(
  eq(storePaymentAccounts.orgId, ctx.orgId),
  eq(storePaymentAccounts.storeId, ctx.storeId),
)

async function linkedIntegrationId(db: DbOrTx, orgId: string, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: sepayIntegrations.id })
    .from(integrationAccounts)
    .innerJoin(sepayIntegrations, and(
      eq(sepayIntegrations.orgId, integrationAccounts.orgId),
      eq(sepayIntegrations.id, integrationAccounts.integrationId),
    ))
    .where(and(
      eq(integrationAccounts.orgId, orgId),
      eq(integrationAccounts.paymentAccountId, accountId),
      ne(sepayIntegrations.status, 'DISABLED'),
    ))
    .orderBy(desc(integrationAccounts.createdAt))
    .limit(1)
  return row?.id ?? null
}

async function toDto(db: DbOrTx, row: AccountRow): Promise<PaymentAccountDto> {
  return {
    id: row.id,
    bankCode: row.bankCode,
    bankName: findBank(row.bankCode)?.shortName ?? row.bankCode,
    accountNumber: row.accountNumber,
    vaNumber: row.vaNumber,
    accountHolder: row.accountHolder,
    qrCheckedAt: row.qrCheckedAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    linkedIntegrationId: await linkedIntegrationId(db, row.orgId, row.id),
  }
}

const rawInput = (row: AccountRow) => ({
  bankCode: row.bankCode,
  accountNumber: row.accountNumber,
  accountHolder: row.accountHolder,
  vaNumber: row.vaNumber,
})

async function lockAccount(db: DbOrTx, ctx: StoreContext, accountId: string): Promise<AccountRow> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(scope(ctx), eq(storePaymentAccounts.id, accountId), eq(storePaymentAccounts.isActive, true)))
    .for('update')
  if (!row) throw notFound()
  return row
}

function toIssues(error: ZodError): PaymentAccountIssue[] {
  return error.issues.map(issue => ({
    field: String(issue.path[0] ?? 'bankCode') as PaymentAccountField,
    message: issue.message,
  }))
}

export async function getPaymentAccount(db: DbOrTx, ctx: StoreContext): Promise<PaymentAccountDto | null> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(scope(ctx), eq(storePaymentAccounts.isActive, true)))
    .limit(1)
  return row ? toDto(db, row) : null
}

export async function createPaymentAccount(db: DbOrTx, ctx: StoreContext, input: PaymentAccountInput): Promise<PaymentAccountDto> {
  try {
    const [row] = await db
      .insert(storePaymentAccounts)
      .values({
        orgId: ctx.orgId,
        storeId: ctx.storeId,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        vaNumber: input.vaNumber,
        accountHolder: input.accountHolder,
      })
      .returning()
    return await toDto(db, row!)
  }
  catch (err) {
    if (isUniqueViolation(err, 'store_payment_accounts_one_active_uq')) {
      throw new AppError('STATUS_CONFLICT', 'Cửa hàng đã có tài khoản nhận tiền, hãy sửa tài khoản hiện có')
    }
    throw err
  }
}

export async function updatePaymentAccount(db: Db, ctx: StoreContext, accountId: string, patch: PaymentAccountPatch): Promise<PaymentAccountDto> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, ctx, accountId)
    const merged = parseWith(paymentAccountInputSchema, {
      bankCode: patch.bankCode ?? row.bankCode,
      accountNumber: patch.accountNumber ?? row.accountNumber,
      accountHolder: patch.accountHolder ?? row.accountHolder,
      vaNumber: patch.vaNumber === undefined ? row.vaNumber : patch.vaNumber,
    })
    const changed = merged.bankCode !== row.bankCode
      || merged.accountNumber !== row.accountNumber
      || merged.accountHolder !== row.accountHolder
      || merged.vaNumber !== row.vaNumber
    if (!changed) return toDto(tx, row)
    // Any edit invalidates the proof that the owner scanned the right account.
    const [updated] = await tx
      .update(storePaymentAccounts)
      .set({ ...merged, qrCheckedAt: null, verifiedAt: null, updatedAt: new Date() })
      .where(eq(storePaymentAccounts.id, row.id))
      .returning()
    return toDto(tx, updated!)
  })
}

export async function checkPaymentAccount(db: DbOrTx, ctx: StoreContext, accountId: string): Promise<PaymentAccountCheck> {
  const [row] = await db
    .select()
    .from(storePaymentAccounts)
    .where(and(scope(ctx), eq(storePaymentAccounts.id, accountId), eq(storePaymentAccounts.isActive, true)))
  if (!row) throw notFound()

  const parsed = paymentAccountInputSchema.safeParse(rawInput(row))
  if (!parsed.success) return { ok: false, revision: null, issues: toIssues(parsed.error), warnings: [], preview: null }

  const bank = findBank(row.bankCode)!
  const qrAccount = row.vaNumber ?? row.accountNumber
  return {
    ok: true,
    revision: paymentAccountRevision(row),
    issues: [],
    warnings: bank.sepayWebhook
      ? []
      : [`SePay chưa liệt kê ${bank.shortName} trong danh sách ngân hàng hỗ trợ webhook; hãy kiểm tra tài khoản đã liên kết trên my.sepay.vn.`],
    preview: {
      bankName: bank.shortName,
      accountNumber: qrAccount,
      accountHolder: row.accountHolder,
      amountVnd: PAYMENT_PREVIEW_AMOUNT_VND,
      transferContent: buildTransferContent(bank.code, PAYMENT_TEST_CODE),
      imageUrl: buildVietQrUrl({
        bankCode: bank.code,
        accountNumber: qrAccount,
        amountVnd: PAYMENT_PREVIEW_AMOUNT_VND,
        paymentCode: PAYMENT_TEST_CODE,
      }),
    },
  }
}

export async function confirmAccountQr(db: Db, ctx: StoreContext, accountId: string, expectedRevision: string, now = new Date()): Promise<PaymentAccountDto> {
  return db.transaction(async (tx) => {
    const row = await lockAccount(tx, ctx, accountId)
    const parsed = paymentAccountInputSchema.safeParse(rawInput(row))
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Thông tin tài khoản chưa hợp lệ', zodIssues(parsed.error))
    if (paymentAccountRevision(row) !== expectedRevision) {
      throw new AppError('STATUS_CONFLICT', 'Thông tin tài khoản đã thay đổi, hãy kiểm tra lại mã QR')
    }
    await tx.update(storePaymentAccounts).set({ qrCheckedAt: now, updatedAt: now }).where(eq(storePaymentAccounts.id, row.id))
    await verifyAccountIfIntegrationActive(tx, ctx.orgId, row.id, now)
    const [fresh] = await tx.select().from(storePaymentAccounts).where(eq(storePaymentAccounts.id, row.id))
    return toDto(tx, fresh!)
  })
}

/** An account becomes verified when the owner checked its QR and an ACTIVE integration (valid webhook seen) covers it. */
export async function verifyAccountIfIntegrationActive(db: DbOrTx, orgId: string, accountId: string, now: Date): Promise<void> {
  await db
    .update(storePaymentAccounts)
    .set({ verifiedAt: now, updatedAt: now })
    .where(and(
      eq(storePaymentAccounts.orgId, orgId),
      eq(storePaymentAccounts.id, accountId),
      isNotNull(storePaymentAccounts.qrCheckedAt),
      isNull(storePaymentAccounts.verifiedAt),
      exists(
        db
          .select({ one: sql`1` })
          .from(integrationAccounts)
          .innerJoin(sepayIntegrations, and(
            eq(sepayIntegrations.orgId, integrationAccounts.orgId),
            eq(sepayIntegrations.id, integrationAccounts.integrationId),
          ))
          .where(and(
            eq(integrationAccounts.orgId, orgId),
            eq(integrationAccounts.paymentAccountId, accountId),
            eq(sepayIntegrations.status, 'ACTIVE'),
            isNotNull(sepayIntegrations.lastValidWebhookAt),
          )),
      ),
    ))
}
