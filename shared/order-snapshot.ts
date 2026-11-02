function collect(entry: unknown, out: string[]): void {
  if (typeof entry === 'string') {
    if (entry) out.push(entry)
    return
  }
  if (!entry || typeof entry !== 'object') return
  const record = entry as Record<string, unknown>
  if (Array.isArray(record.values)) {
    for (const inner of record.values) collect(inner, out)
    return
  }
  const label = record.valueName ?? record.name ?? record.label
  if (typeof label === 'string' && label) out.push(label)
}

/** Rút nhãn option từ `order_items.options_snapshot_json` mà không phụ thuộc cứng vào hình dạng JSON. */
export function optionLabels(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return []
  const out: string[] = []
  for (const entry of snapshot) collect(entry, out)
  return out
}
