export interface CategoryGroup<T> {
  id: string | null
  name: string
  products: T[]
}

export function groupByCategory<T extends { categoryId: string | null }>(
  categories: ReadonlyArray<{ id: string, name: string }>,
  products: ReadonlyArray<T>,
  opts: { keepEmpty?: boolean, uncategorizedLabel?: string } = {},
): CategoryGroup<T>[] {
  const known = new Set(categories.map(category => category.id))
  const groups: CategoryGroup<T>[] = categories
    .map(category => ({ id: category.id, name: category.name, products: products.filter(product => product.categoryId === category.id) }))
    .filter(group => opts.keepEmpty || group.products.length > 0)

  const loose = products.filter(product => product.categoryId === null || !known.has(product.categoryId))
  if (loose.length > 0) groups.push({ id: null, name: opts.uncategorizedLabel ?? 'Món khác', products: [...loose] })
  return groups
}
