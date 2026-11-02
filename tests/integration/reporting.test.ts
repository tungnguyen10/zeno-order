import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { getReport } from '../../server/services/reporting/reports'
import { getDailySummary } from '../../server/services/reporting/summary'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createOrderItem, createOrderRow, createPaymentRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ctxOf = (t: Tenant): StoreContext => ({ orgId: t.org.id, storeId: t.store.id, role: 'OWNER', userId: t.owner.userId })
const at = (iso: string) => new Date(iso)

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('getDailySummary — Vietnam day boundaries', () => {
  it('puts 23:30, 00:00 sharp, 00:30 and 23:59:59.999 on the right VN day', async () => {
    const a = await createTenant('tz')
    await createOrderRow(a.store, { createdAt: at('2026-10-30T16:30:00.000Z') }) // 23:30 ngày 30
    await createOrderRow(a.store, { createdAt: at('2026-10-30T17:00:00.000Z') }) // 00:00 ngày 31
    await createOrderRow(a.store, { createdAt: at('2026-10-30T17:30:00.000Z') }) // 00:30 ngày 31
    await createOrderRow(a.store, { createdAt: at('2026-10-31T16:59:59.999Z') }) // 23:59:59.999 ngày 31
    await createOrderRow(a.store, { createdAt: at('2026-10-31T17:00:00.000Z') }) // 00:00 ngày 1/11

    const total = async (date: string) => (await getDailySummary(getDb(), ctxOf(a), date)).totalOrders
    expect(await total('2026-10-30')).toBe(1)
    expect(await total('2026-10-31')).toBe(3)
    expect(await total('2026-11-01')).toBe(1)
  })

  it('defaults to today in Vietnam, not in UTC', async () => {
    const a = await createTenant('today')
    await createOrderRow(a.store, { createdAt: at('2026-10-30T17:30:00Z') })
    const summary = await getDailySummary(getDb(), ctxOf(a), undefined, at('2026-10-30T18:00:00Z'))
    expect(summary).toMatchObject({ date: '2026-10-31', totalOrders: 1 })
  })
})

describe('getDailySummary — money', () => {
  it('counts value excluding cancelled, collected from order_payments only, outstanding and refund due', async () => {
    const a = await createTenant('money')
    const day = at('2026-10-31T05:00:00Z')
    const completedCash = await createOrderRow(a.store, { status: 'COMPLETED', paymentStatus: 'PAID', totalVnd: 50_000, createdAt: day })
    await createPaymentRow(completedCash, { method: 'CASH', amountVnd: 50_000 })
    await createOrderRow(a.store, { status: 'NEW', totalVnd: 30_000, createdAt: day })
    const sepay = await createOrderRow(a.store, { status: 'NEW', paymentMethod: 'BANK_QR', paymentStatus: 'PAID', totalVnd: 40_000, createdAt: day })
    await createPaymentRow(sepay, { method: 'SEPAY', amountVnd: 40_000 })
    await createOrderRow(a.store, { status: 'CANCELLED', totalVnd: 20_000, createdAt: day })
    const refund = await createOrderRow(a.store, { status: 'CANCELLED', paymentStatus: 'REFUND_DUE', totalVnd: 25_000, createdAt: day })
    await createPaymentRow(refund, { method: 'CASH', amountVnd: 25_000 })
    // PAID nhưng không có dòng order_payments: phải tính vào giá trị đơn, KHÔNG tính vào đã thu.
    await createOrderRow(a.store, { status: 'NEW', paymentStatus: 'PAID', totalVnd: 10_000, createdAt: day })

    const summary = await getDailySummary(getDb(), ctxOf(a), '2026-10-31')
    expect(summary).toEqual({
      date: '2026-10-31',
      totalOrders: 6,
      completedCount: 1,
      cancelledCount: 2,
      grossVnd: 130_000,
      collected: { SEPAY: 40_000, CASH: 50_000, BANK_MANUAL: 0 },
      collectedVnd: 90_000,
      outstandingVnd: 40_000,
      refundDueVnd: 25_000,
    })
  })

  it('returns zeros for an empty day and ignores other stores', async () => {
    const a = await createTenant('empty')
    const b = await createTenant('empty-b')
    await createOrderRow(b.store, { createdAt: at('2026-10-31T05:00:00Z'), totalVnd: 99_000 })
    expect(await getDailySummary(getDb(), ctxOf(a), '2026-10-31')).toMatchObject({
      totalOrders: 0, grossVnd: 0, collectedVnd: 0, outstandingVnd: 0, refundDueVnd: 0,
      collected: { SEPAY: 0, CASH: 0, BANK_MANUAL: 0 },
    })
  })
})

describe('getReport', () => {
  const now = at('2026-10-31T05:00:00Z') // 12:00 giờ VN ngày 31/10
  const noon = (date: string) => at(`${date}T05:00:00Z`)

  async function seed(a: Tenant) {
    const today = await createOrderRow(a.store, { status: 'COMPLETED', paymentStatus: 'PAID', totalVnd: 100_000, createdAt: noon('2026-10-31') })
    await createPaymentRow(today, { amountVnd: 100_000 })
    await createOrderItem(today, { nameSnapshot: 'Trà đào', qty: 3, lineTotalVnd: 90_000 })
    await createOrderItem(today, { nameSnapshot: 'Cà phê', qty: 1, lineTotalVnd: 10_000 })
    const threeDays = await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 40_000, createdAt: noon('2026-10-28') })
    await createOrderItem(threeDays, { nameSnapshot: 'Trà đào', qty: 2, lineTotalVnd: 40_000 })
    const cancelled = await createOrderRow(a.store, { status: 'CANCELLED', totalVnd: 300_000, createdAt: noon('2026-10-31') })
    await createOrderItem(cancelled, { nameSnapshot: 'Trà đào', qty: 10, lineTotalVnd: 300_000 })
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 10_000, createdAt: noon('2026-10-25') }) // trong 7d
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 20_000, createdAt: noon('2026-10-24') }) // ngoài 7d
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 5_000, createdAt: noon('2026-10-02') }) // trong 30d
    await createOrderRow(a.store, { status: 'COMPLETED', totalVnd: 7_000, createdAt: noon('2026-10-01') }) // ngoài 30d
  }

  it('today: one order, cancelled excluded from value and top products', async () => {
    const a = await createTenant('r-today')
    await seed(a)
    const report = await getReport(getDb(), ctxOf(a), 'today', now)
    expect(report).toMatchObject({ range: 'today', fromDate: '2026-10-31', toDate: '2026-10-31', orderCount: 1, cancelledCount: 1, grossVnd: 100_000, collectedVnd: 100_000, averageOrderVnd: 100_000 })
    expect(report.topProducts).toEqual([
      { name: 'Trà đào', qty: 3, revenueVnd: 90_000 },
      { name: 'Cà phê', qty: 1, revenueVnd: 10_000 },
    ])
    expect(report.daily).toEqual([{ date: '2026-10-31', orderCount: 1, grossVnd: 100_000, collectedVnd: 100_000 }])
  })

  it('7d: includes day -6, excludes day -7, zero-fills empty days, sums top products', async () => {
    const a = await createTenant('r-7d')
    await seed(a)
    const report = await getReport(getDb(), ctxOf(a), '7d', now)
    expect(report).toMatchObject({ fromDate: '2026-10-25', toDate: '2026-10-31', orderCount: 3, cancelledCount: 1, grossVnd: 150_000, collectedVnd: 100_000, averageOrderVnd: 50_000 })
    expect(report.daily.map(d => d.date)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
    expect(report.daily.find(d => d.date === '2026-10-26')).toEqual({ date: '2026-10-26', orderCount: 0, grossVnd: 0, collectedVnd: 0 })
    expect(report.daily.find(d => d.date === '2026-10-25')).toMatchObject({ orderCount: 1, grossVnd: 10_000 })
    expect(report.topProducts[0]).toEqual({ name: 'Trà đào', qty: 5, revenueVnd: 130_000 })
  })

  it('30d: window edges and daily length', async () => {
    const a = await createTenant('r-30d')
    await seed(a)
    const report = await getReport(getDb(), ctxOf(a), '30d', now)
    expect(report).toMatchObject({ fromDate: '2026-10-02', orderCount: 5, grossVnd: 175_000 })
    expect(report.daily).toHaveLength(30)
  })

  it('groups an order created at 00:30 VN into the new VN day (SQL grouping matches the JS window)', async () => {
    const a = await createTenant('r-edge')
    await createOrderRow(a.store, { totalVnd: 12_000, createdAt: at('2026-10-30T17:30:00Z') })
    await createOrderRow(a.store, { totalVnd: 8_000, createdAt: at('2026-10-30T16:30:00Z') })
    const report = await getReport(getDb(), ctxOf(a), '7d', now)
    expect(report.daily.find(d => d.date === '2026-10-31')).toMatchObject({ orderCount: 1, grossVnd: 12_000 })
    expect(report.daily.find(d => d.date === '2026-10-30')).toMatchObject({ orderCount: 1, grossVnd: 8_000 })
  })

  it('never includes another store\'s orders or items', async () => {
    const a = await createTenant('r-iso-a')
    const b = await createTenant('r-iso-b')
    const foreign = await createOrderRow(b.store, { totalVnd: 77_000, createdAt: noon('2026-10-31') })
    await createOrderItem(foreign, { nameSnapshot: 'Món của B', qty: 9 })
    const report = await getReport(getDb(), ctxOf(a), '30d', now)
    expect(report).toMatchObject({ orderCount: 0, grossVnd: 0, averageOrderVnd: 0, topProducts: [] })
  })
})
