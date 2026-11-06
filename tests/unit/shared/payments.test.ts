import { describe, expect, it } from 'vitest'
import {
  BANK_TX_STATUSES, RESOLUTIONS, RESOLUTION_LABEL, REVIEW_REASONS, REVIEW_REASON_LABEL,
} from '#shared/payments'

describe('shared/payments', () => {
  it('has a Vietnamese label for every review reason and resolution', () => {
    for (const reason of REVIEW_REASONS) expect(REVIEW_REASON_LABEL[reason].length).toBeGreaterThan(5)
    for (const resolution of RESOLUTIONS) expect(RESOLUTION_LABEL[resolution].length).toBeGreaterThan(3)
  })

  it('keeps the status list in sync with spec §4.3', () => {
    expect([...BANK_TX_STATUSES]).toEqual(['RECEIVED', 'MATCHED', 'REVIEW_REQUIRED', 'IGNORED', 'RESOLVED'])
  })
})
