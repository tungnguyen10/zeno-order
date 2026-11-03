import { createHash } from 'node:crypto'

type AccountRecipient = {
  id: string
  bankCode: string
  accountNumber: string
  vaNumber: string | null
  accountHolder: string
}

/** Binds an owner's QR confirmation to the recipient that was shown in the preview. */
export function paymentAccountRevision(account: AccountRecipient): string {
  return createHash('sha256')
    .update(JSON.stringify([account.id, account.bankCode, account.accountNumber, account.vaNumber, account.accountHolder]))
    .digest('hex')
}
