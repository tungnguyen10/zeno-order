import { describe, expect, it } from 'vitest'
import type { PublicProduct } from '#shared/types/catalog'
import { planReorder } from '../../../app/utils/reorder'
import type { RecentOrderItem } from '../../../app/utils/recent-orders'

const product = (over: Partial<PublicProduct> = {}): PublicProduct => ({
  id: 'p1',
  categoryId: null,
  name: 'Trà sữa',
  description: null,
  basePriceVnd: 30_000,
  isAvailable: true,
  imageUrl: null,
  optionGroups: [],
  ...over,
})

const withSize = (over: Partial<PublicProduct> = {}): PublicProduct => product({
  id: 'p2',
  name: 'Cà phê',
  basePriceVnd: 25_000,
  optionGroups: [{
    id: 'g1',
    name: 'Size',
    required: true,
    minSelect: 1,
    maxSelect: 1,
    values: [
      { id: 'm', name: 'M', priceDeltaVnd: 0 },
      { id: 'l', name: 'L', priceDeltaVnd: 5_000 },
    ],
  }],
  ...over,
})

const item = (over: Partial<RecentOrderItem> = {}): RecentOrderItem => ({
  productId: 'p1',
  name: 'Trà sữa',
  optionValueIds: [],
  quantity: 1,
  note: '',
  ...over,
})

describe('planReorder', () => {
  it('rebuilds a line for an available product and prices it against the current menu', () => {
    const plan = planReorder([item({ quantity: 2 })], [product({ basePriceVnd: 32_000 })])
    expect(plan).toMatchObject({ added: 1, skipped: 0 })
    expect(plan.lines[0]).toMatchObject({ productId: 'p1', quantity: 2, unitPriceVnd: 32_000 })
  })

  it('rebuilds options and includes their price delta', () => {
    const plan = planReorder([item({ productId: 'p2', optionValueIds: ['l'] })], [withSize()])
    expect(plan.added).toBe(1)
    expect(plan.lines[0]).toMatchObject({ optionValueIds: ['l'], optionLabels: ['L'], unitPriceVnd: 30_000 })
  })

  it('skips a product that is gone from the menu', () => {
    const plan = planReorder([item({ productId: 'missing' })], [product()])
    expect(plan).toMatchObject({ added: 0, skipped: 1, lines: [] })
  })

  it('skips an unavailable product', () => {
    const plan = planReorder([item()], [product({ isAvailable: false })])
    expect(plan).toMatchObject({ added: 0, skipped: 1 })
  })

  it('skips an item whose selected option no longer exists', () => {
    const plan = planReorder([item({ productId: 'p2', optionValueIds: ['xl'] })], [withSize()])
    expect(plan).toMatchObject({ added: 0, skipped: 1 })
  })

  it('skips an item that no longer satisfies a required group', () => {
    const plan = planReorder([item({ productId: 'p2', optionValueIds: [] })], [withSize()])
    expect(plan).toMatchObject({ added: 0, skipped: 1 })
  })

  it('clamps an out-of-range stored quantity into the allowed bounds', () => {
    const plan = planReorder([item({ quantity: 9999 })], [product()])
    expect(plan.lines[0]!.quantity).toBe(50)
  })

  it('mixes kept and dropped items in one order', () => {
    const plan = planReorder(
      [item(), item({ productId: 'gone' }), item({ productId: 'p2', optionValueIds: ['m'] })],
      [product(), withSize()],
    )
    expect(plan).toMatchObject({ added: 2, skipped: 1 })
    expect(plan.lines.map(line => line.productId)).toEqual(['p1', 'p2'])
  })
})
