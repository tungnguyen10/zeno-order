import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '../../../server/services/ordering/board'

describe('board cursor validation', () => {
  it('preserves microseconds without passing through a JavaScript Date', () => {
    const cursor = { createdAt: '2026-11-01 10:00:00.123456+00', id: randomUUID() }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it.each(['2026-99-01 10:00:00+00', '2026-02-31 10:00:00+00', '2026-11-01 99:00:00+00'])('rejects impossible timestamp %s before querying Postgres', (createdAt) => {
    expect(() => decodeCursor(encodeCursor({ createdAt, id: randomUUID() }))).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
  })
})
