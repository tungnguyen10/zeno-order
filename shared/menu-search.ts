export const SEARCH_THRESHOLD = 15

export function normalizeSearch(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
}

export function filterProducts<T extends { name: string }>(products: readonly T[], query: string): T[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...products]
  return products.filter(product => {
    const name = normalizeSearch(product.name)
    return terms.every(term => name.includes(term))
  })
}

export function shouldShowSearch(productCount: number): boolean {
  return productCount > SEARCH_THRESHOLD
}
