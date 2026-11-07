// Restore comparisons require an immutable snapshot/paused-write source, not loose row-count bounds.
export function compareRestore(before, restored) {
  const problems = []
  const names = Object.keys(before).sort()
  if (!names.length || names.join('|') !== Object.keys(restored).sort().join('|')) problems.push('Table inventory differs or is empty')
  for (const name of names) if (before[name] !== restored[name]) problems.push(`Snapshot data differs in ${name}`)
  return problems
}
