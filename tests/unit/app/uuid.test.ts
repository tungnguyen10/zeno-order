import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { uuidv4 } from '../../../app/utils/uuid'

afterEach(() => vi.unstubAllGlobals())

describe('uuidv4', () => {
  it('returns a valid v4 uuid', () => {
    expect(z.uuid().safeParse(uuidv4()).success).toBe(true)
  })

  it('still works where crypto.randomUUID is missing (http:// LAN pages)', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
    const ids = Array.from({ length: 50 }, () => uuidv4())
    for (const id of ids) expect(z.uuid().safeParse(id).success).toBe(true)
    expect(new Set(ids).size).toBe(50)
  })
})
