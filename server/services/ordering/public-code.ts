import { randomInt } from 'node:crypto'

export const PUBLIC_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
export const PUBLIC_CODE_LENGTH = 6

export function generatePublicCode(): string {
  let code = ''
  for (let i = 0; i < PUBLIC_CODE_LENGTH; i++) code += PUBLIC_CODE_ALPHABET[randomInt(PUBLIC_CODE_ALPHABET.length)]
  return code
}
