import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { orderTotals, priceLine, validateSelection, type OptionGroupRule } from '#shared/pricing'
import type { CheckoutInput } from '#shared/schemas/checkout'
import type { OrderStatus, PaymentStatus } from '#shared/enums'
import type { CartStaleDetails, CartStaleLine, CartStaleReason, CreateOrderResponse, OrderItemOptionSnapshot } from '#shared/types/order'
import type { Db, DbOrTx, Tx } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { deliveryZones, orderEvents, orderItems, orders, productOptionGroups, productOptionValues, products, storeTables, stores } from '../../db/schema'
import { decryptSecret, encryptSecret } from '../../utils/crypto'
import { AppError } from '../../utils/errors'
import { generateToken, hashToken } from '../../utils/tokens'
import { CHECKOUT_RATE_LIMIT, MAX_PUBLIC_CODE_ATTEMPTS } from './constants'
import { generatePublicCode } from './public-code'
import { consumeRateLimit } from './rate-limit'

export interface CreateOrderResult {
  response: CreateOrderResponse
  /** True when an earlier request with the same idempotency key already created this order. */
  replayed: boolean
}

export interface CreateOrderDeps {
  generatePublicCode?: () => string
  /** Test seam: runs inside the transaction after every row is written. */
  beforeCommit?: (tx: Tx) => Promise<void>
}

type OrderRow = typeof orders.$inferSelect

interface PublicStore {
  id: string
  orgId: string
  isAcceptingOrders: boolean
  dineInEnabled: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
}

interface Place {
  tableId: string | null
  tableLabel: string | null
  zoneId: string | null
  zoneName: string | null
  deliveryFeeVnd: number
}

interface PricedLine {
  productId: string
  name: string
  options: OrderItemOptionSnapshot[]
  quantity: number
  unitPriceVnd: number
  lineTotalVnd: number
  note: string | null
}

const MODE_FLAG = { DINE_IN: 'dineInEnabled', PICKUP: 'pickupEnabled', DELIVERY: 'deliveryEnabled' } as const

export async function createOrder(
  db: Db,
  args: { slug: string, input: CheckoutInput, ip: string | null },
  deps: CreateOrderDeps = {},
): Promise<CreateOrderResult> {
  const { input } = args
  const store = await findPublicStore(db, args.slug)

  // A retry must never be throttled, so the idempotency lookup comes before the rate limit.
  const existing = await findByIdempotencyKey(db, store.id, input.idempotencyKey)
  if (existing) return replay(existing)

  try {
    const result = await db.transaction(tx => placeOrder(tx, store, input, args.ip, deps))
    // Expected preflight failures commit their rate charge, without writing any order rows.
    if ('error' in result) throw result.error
    return result
  }
  catch (err) {
    // Safety net: the advisory lock below already serialises same-key requests.
    if (isUniqueViolation(err, 'orders_store_idem_uq')) {
      const winner = await findByIdempotencyKey(db, store.id, input.idempotencyKey)
      if (winner) return replay(winner)
    }
    throw err
  }
}

async function placeOrder(tx: Tx, store: PublicStore, input: CheckoutInput, ip: string | null, deps: CreateOrderDeps): Promise<CreateOrderResult | { error: AppError }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`order:${store.id}:${input.idempotencyKey}`}))`)
  const existing = await findByIdempotencyKey(tx, store.id, input.idempotencyKey)
  if (existing) return replay(existing)

  const allowed = await consumeRateLimit(tx, `checkout:${store.id}:${hashIp(ip)}`, CHECKOUT_RATE_LIMIT)
  if (!allowed) return { error: new AppError('RATE_LIMITED', 'Bạn đặt quá nhanh, vui lòng thử lại sau ít phút') }

  let prepared: Awaited<ReturnType<typeof prepareOrder>>
  try {
    prepared = await prepareOrder(tx, store, input)
  }
  catch (error) {
    // Only business validation is converted to a committed outcome, before order writes begin.
    if (error instanceof AppError) return { error }
    throw error
  }
  const { payment, place, lines, totals } = prepared

  const guestToken = generateToken()
  const makeCode = deps.generatePublicCode ?? generatePublicCode
  let order: OrderRow | undefined
  for (let attempt = 0; attempt < MAX_PUBLIC_CODE_ATTEMPTS && !order; attempt++) {
    const [row] = await tx
      .insert(orders)
      .values({
        orgId: store.orgId,
        storeId: store.id,
        publicCode: makeCode(),
        guestTokenHash: hashToken(guestToken),
        guestTokenEncrypted: encryptSecret(guestToken),
        fulfillmentType: input.fulfillmentType,
        tableId: place.tableId,
        tableLabel: place.tableLabel,
        customerName: input.customer.name,
        customerPhone: input.customer.phone,
        deliveryZoneId: place.zoneId,
        deliveryZoneName: place.zoneName,
        addressSnapshot: input.customer.address,
        notes: input.note,
        subtotalVnd: totals.subtotalVnd,
        deliveryFeeVnd: totals.deliveryFeeVnd,
        totalVnd: totals.totalVnd,
        status: payment.status,
        paymentMethod: input.paymentMethod,
        paymentStatus: payment.paymentStatus,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: [orders.storeId, orders.publicCode] })
      .returning()
    order = row
  }
  if (!order) throw new Error(`Could not allocate a unique public code after ${MAX_PUBLIC_CODE_ATTEMPTS} attempts`)

  await tx.insert(orderItems).values(lines.map((line, position) => ({
    orgId: store.orgId,
    storeId: store.id,
    orderId: order.id,
    productId: line.productId,
    position,
    nameSnapshot: line.name,
    optionsSnapshotJson: line.options,
    qty: line.quantity,
    unitPriceVnd: line.unitPriceVnd,
    lineTotalVnd: line.lineTotalVnd,
    note: line.note,
  })))
  await tx.insert(orderEvents).values({
    orgId: store.orgId,
    storeId: store.id,
    orderId: order.id,
    eventType: 'CREATED',
    fromState: null,
    toState: order.status,
    metadata: { paymentMethod: input.paymentMethod, fulfillmentType: input.fulfillmentType, itemCount: lines.length },
  })
  await deps.beforeCommit?.(tx)

  return {
    response: { publicCode: order.publicCode, guestToken, status: order.status, paymentStatus: order.paymentStatus, totalVnd: order.totalVnd },
    replayed: false,
  }
}

async function prepareOrder(tx: Tx, store: PublicStore, input: CheckoutInput) {
  const [currentStore] = await tx.select().from(stores)
    .where(and(eq(stores.id, store.id), eq(stores.orgId, store.orgId), eq(stores.status, 'ACTIVE')))
    .for('share')
  if (!currentStore) throw new AppError('NOT_FOUND', 'Không tìm thấy cửa hàng')
  assertStoreAcceptsOrders(currentStore, input)
  const payment = resolvePayment(input)
  const place = await resolvePlace(tx, store, input)
  const lines = await priceCart(tx, store.id, input.items, place)
  const totals = orderTotals({ lineTotalsVnd: lines.map(line => line.lineTotalVnd), deliveryFeeVnd: place.deliveryFeeVnd })
  if (totals.totalVnd !== input.expectedTotalVnd) {
    const details: CartStaleDetails = { lines: [], deliveryFeeVnd: place.zoneId ? totals.deliveryFeeVnd : null, totalVnd: totals.totalVnd }
    throw new AppError('CART_STALE', 'Phí giao hoặc tổng tiền đã thay đổi, vui lòng kiểm tra lại', details)
  }

  return { payment, place, lines, totals }
}

async function findPublicStore(db: DbOrTx, slug: string): Promise<PublicStore> {
  const [row] = await db
    .select({
      id: stores.id,
      orgId: stores.orgId,
      isAcceptingOrders: stores.isAcceptingOrders,
      dineInEnabled: stores.dineInEnabled,
      pickupEnabled: stores.pickupEnabled,
      deliveryEnabled: stores.deliveryEnabled,
    })
    .from(stores)
    .where(and(eq(stores.slug, slug), eq(stores.status, 'ACTIVE')))
    .limit(1)
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy cửa hàng')
  return row
}

async function findByIdempotencyKey(db: DbOrTx, storeId: string, key: string): Promise<OrderRow | undefined> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(orders.idempotencyKey, key)))
    .limit(1)
  return row
}

function replay(order: OrderRow): CreateOrderResult {
  return {
    response: {
      publicCode: order.publicCode,
      guestToken: decryptSecret(order.guestTokenEncrypted),
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalVnd: order.totalVnd,
    },
    replayed: true,
  }
}

function hashIp(ip: string | null): string {
  return createHash('sha256').update(ip ?? 'unknown').digest('hex').slice(0, 16)
}

function assertStoreAcceptsOrders(store: PublicStore, input: CheckoutInput): void {
  if (!store.isAcceptingOrders) throw new AppError('STORE_CLOSED', 'Quán đang tạm nghỉ, chưa nhận đơn')
  if (!store[MODE_FLAG[input.fulfillmentType]]) throw new AppError('MODE_DISABLED', 'Quán không nhận đơn theo hình thức này')
}

/** The only place that decides the initial status; PR5 adds the BANK_QR branch here. */
function resolvePayment(input: CheckoutInput): { status: OrderStatus, paymentStatus: PaymentStatus } {
  if (input.paymentMethod === 'BANK_QR') {
    throw new AppError('PAYMENT_METHOD_UNAVAILABLE', 'Quán chưa hỗ trợ thanh toán chuyển khoản')
  }
  return { status: 'NEW', paymentStatus: 'UNPAID' }
}

async function resolvePlace(tx: Tx, store: PublicStore, input: CheckoutInput): Promise<Place> {
  const none: Place = { tableId: null, tableLabel: null, zoneId: null, zoneName: null, deliveryFeeVnd: 0 }

  if (input.fulfillmentType === 'DINE_IN') {
    const [table] = input.tableToken
      ? await tx
          .select({ id: storeTables.id, displayName: storeTables.displayName })
          .from(storeTables)
          .where(and(eq(storeTables.storeId, store.id), eq(storeTables.tokenHash, hashToken(input.tableToken)), eq(storeTables.active, true)))
          .limit(1)
      : []
    if (!table) throw new AppError('INVALID_TABLE', 'Mã QR bàn không hợp lệ, vui lòng quét lại')
    return { ...none, tableId: table.id, tableLabel: table.displayName }
  }

  if (input.fulfillmentType === 'DELIVERY') {
    const [zone] = input.deliveryZoneId
      ? await tx
          .select({ id: deliveryZones.id, name: deliveryZones.name, feeVnd: deliveryZones.feeVnd })
          .from(deliveryZones)
          .where(and(eq(deliveryZones.storeId, store.id), eq(deliveryZones.id, input.deliveryZoneId), eq(deliveryZones.active, true)))
          .limit(1)
      : []
    if (!zone) throw new AppError('INVALID_ZONE', 'Khu vực giao hàng không hợp lệ')
    return { ...none, zoneId: zone.id, zoneName: zone.name, deliveryFeeVnd: zone.feeVnd }
  }

  return none
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, item: V): void {
  const list = map.get(key)
  if (list) list.push(item)
  else map.set(key, [item])
}

async function priceCart(tx: Tx, storeId: string, items: CheckoutInput['items'], place: Place): Promise<PricedLine[]> {
  const productIds = [...new Set(items.map(item => item.productId))]
  const productRows = await tx
    .select({ id: products.id, name: products.name, basePriceVnd: products.basePriceVnd, isAvailable: products.isAvailable, active: products.active })
    .from(products)
    .where(and(eq(products.storeId, storeId), inArray(products.id, productIds)))
  const groupRows = await tx
    .select({
      id: productOptionGroups.id,
      productId: productOptionGroups.productId,
      name: productOptionGroups.name,
      minSelect: productOptionGroups.minSelect,
      maxSelect: productOptionGroups.maxSelect,
      required: productOptionGroups.required,
    })
    .from(productOptionGroups)
    .where(and(eq(productOptionGroups.storeId, storeId), inArray(productOptionGroups.productId, productIds)))
    .orderBy(asc(productOptionGroups.position), asc(productOptionGroups.id))
  const valueRows = groupRows.length === 0
    ? []
    : await tx
        .select({
          id: productOptionValues.id,
          groupId: productOptionValues.groupId,
          name: productOptionValues.name,
          priceDeltaVnd: productOptionValues.priceDeltaVnd,
          active: productOptionValues.active,
        })
        .from(productOptionValues)
        .where(and(eq(productOptionValues.storeId, storeId), inArray(productOptionValues.groupId, groupRows.map(group => group.id))))
        .orderBy(asc(productOptionValues.position), asc(productOptionValues.id))

  const valuesByGroup = new Map<string, typeof valueRows>()
  for (const value of valueRows) pushTo(valuesByGroup, value.groupId, value)

  interface ProductRules {
    rules: OptionGroupRule[]
    snapshots: Map<string, OrderItemOptionSnapshot>
  }
  const rulesByProduct = new Map<string, ProductRules>()
  for (const group of groupRows) {
    const values = valuesByGroup.get(group.id) ?? []
    let entry = rulesByProduct.get(group.productId)
    if (!entry) {
      entry = { rules: [], snapshots: new Map() }
      rulesByProduct.set(group.productId, entry)
    }
    entry.rules.push({
      id: group.id,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      required: group.required,
      values: values.map(value => ({ id: value.id, priceDeltaVnd: value.priceDeltaVnd, active: value.active })),
    })
    for (const value of values) {
      entry.snapshots.set(value.id, { groupId: group.id, groupName: group.name, valueId: value.id, valueName: value.name, priceDeltaVnd: value.priceDeltaVnd })
    }
  }

  const productById = new Map(productRows.map(product => [product.id, product]))
  const priced: PricedLine[] = []
  const staleLines: CartStaleLine[] = []

  for (const [index, item] of items.entries()) {
    const product = productById.get(item.productId)
    const flag = (reason: CartStaleReason, currentUnitPriceVnd: number | null = null) => {
      staleLines.push({ index, productId: item.productId, name: product?.name ?? null, reason, currentUnitPriceVnd })
    }

    if (!product || !product.active || !product.isAvailable) {
      flag('PRODUCT_UNAVAILABLE')
      continue
    }
    const entry = rulesByProduct.get(product.id) ?? { rules: [], snapshots: new Map<string, OrderItemOptionSnapshot>() }
    const selection = validateSelection(entry.rules, item.optionValueIds)
    if (!selection.ok) {
      flag('OPTION_INVALID')
      continue
    }
    const options = selection.valueIds.map(id => entry.snapshots.get(id)!)
    const { unitPriceVnd, lineTotalVnd } = priceLine({
      basePriceVnd: product.basePriceVnd,
      deltasVnd: options.map(option => option.priceDeltaVnd),
      quantity: item.quantity,
    })
    if (unitPriceVnd !== item.expectedUnitPriceVnd) {
      flag('PRICE_CHANGED', unitPriceVnd)
      continue
    }
    priced.push({ productId: product.id, name: product.name, options, quantity: item.quantity, unitPriceVnd, lineTotalVnd, note: item.note })
  }

  if (staleLines.length > 0) {
    const details: CartStaleDetails = { lines: staleLines, deliveryFeeVnd: place.zoneId ? place.deliveryFeeVnd : null, totalVnd: null }
    throw new AppError('CART_STALE', 'Giỏ hàng đã thay đổi, vui lòng kiểm tra lại', details)
  }
  return priced
}
