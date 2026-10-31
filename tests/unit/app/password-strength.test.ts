import { describe, expect, it } from 'vitest'
import { passwordStrength } from '../../../app/utils/password-strength'

describe('passwordStrength', () => {
  it.each([
    ['', 0, ''],
    ['abc', 1, 'Yếu'],
    ['abcdefg', 1, 'Yếu'],
    ['abcdefgh', 2, 'Khá'],
    ['abcdefghijk', 2, 'Khá'],
    ['abcdefghijkl', 3, 'Tốt'],
    ['abcdefghijklmno', 3, 'Tốt'],
    ['abcdefghijklmnop', 4, 'Rất tốt'],
  ])('%j → level %i (%s)', (password, level, label) => {
    expect(passwordStrength(password)).toEqual({ level, label })
  })

  it('counts Vietnamese characters as single characters', () => {
    expect(passwordStrength('mậtkhẩuạ').level).toBe(2)
  })
})
