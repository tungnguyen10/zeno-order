import { describe, expect, it } from 'vitest'
import { groupByCategory } from '#shared/menu-groups'

const categories = [{ id: 'c1', name: 'Trà sữa' }, { id: 'c2', name: 'Cà phê' }, { id: 'c3', name: 'Rỗng' }]
const p = (id: string, categoryId: string | null) => ({ id, categoryId })

describe('groupByCategory', () => {
  it('keeps category order and product order, and drops empty categories', () => {
    const groups = groupByCategory(categories, [p('a', 'c2'), p('b', 'c1'), p('c', 'c2')])
    expect(groups.map(g => [g.id, g.products.map(x => x.id)])).toEqual([['c1', ['b']], ['c2', ['a', 'c']]])
  })

  it('puts uncategorised products in a last group', () => {
    const groups = groupByCategory(categories, [p('a', null), p('b', 'c1')])
    expect(groups.map(g => [g.id, g.name])).toEqual([['c1', 'Trà sữa'], [null, 'Món khác']])
  })

  it('treats a product with an unknown category as uncategorised', () => {
    expect(groupByCategory(categories, [p('a', 'gone')]).map(g => g.id)).toEqual([null])
  })

  it('keeps empty categories when asked (owner view)', () => {
    expect(groupByCategory(categories, [], { keepEmpty: true }).map(g => g.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('returns no groups for an empty menu', () => {
    expect(groupByCategory([], [])).toEqual([])
  })

  it('supports a custom label for the uncategorised group', () => {
    expect(groupByCategory([], [p('a', null)], { uncategorizedLabel: 'Chưa phân loại' })[0]!.name).toBe('Chưa phân loại')
  })
})
