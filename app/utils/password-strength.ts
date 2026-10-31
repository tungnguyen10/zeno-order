export interface PasswordStrength {
  level: 0 | 1 | 2 | 3 | 4
  label: string
}

/** Length-based strength for the sign-up meter; the server-side rule stays "at least 8 characters". */
export function passwordStrength(password: string): PasswordStrength {
  const length = [...password].length
  if (length === 0) return { level: 0, label: '' }
  if (length < 8) return { level: 1, label: 'Yếu' }
  if (length < 12) return { level: 2, label: 'Khá' }
  if (length < 16) return { level: 3, label: 'Tốt' }
  return { level: 4, label: 'Rất tốt' }
}
