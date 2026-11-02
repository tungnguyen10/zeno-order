import { describe, expect, it } from 'vitest'
import { filterProducts, normalizeSearch, SEARCH_THRESHOLD, shouldShowSearch } from '#shared/menu-search'

const products = [{ name: 'Trà sữa trân châu' }, { name: 'Cà phê muối' }, { name: 'Đậu đỏ đá xay' }]

describe('normalizeSearch', () => {
  it('lower-cases and strips Vietnamese diacritics', () => {
    expect(normalizeSearch('Trà Sữa Đậu Đỏ')).toBe('tra sua dau do')
  })
})

describe('filterProducts', () => {
  it('matches without diacritics and in any word order', () => {
    expect(filterProducts(products, 'tra sua').map(p => p.name)).toEqual(['Trà sữa trân châu'])
    expect(filterProducts(products, 'SUA TRA').map(p => p.name)).toEqual(['Trà sữa trân châu'])
    expect(filterProducts(products, 'dau do').map(p => p.name)).toEqual(['Đậu đỏ đá xay'])
    expect(filterProducts(products, 'ca phe').map(p => p.name)).toEqual(['Cà phê muối'])
  })

  it('returns everything for a blank query and nothing for a miss', () => {
    expect(filterProducts(products, '   ')).toHaveLength(3)
    expect(filterProducts(products, 'xyz')).toEqual([])
  })
})

describe('shouldShowSearch', () => {
  it('only appears above the threshold', () => {
    expect(SEARCH_THRESHOLD).toBe(15)
    expect(shouldShowSearch(15)).toBe(false)
    expect(shouldShowSearch(16)).toBe(true)
  })
})
