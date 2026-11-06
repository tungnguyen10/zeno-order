import { and, eq, ne } from 'drizzle-orm'
import type { SepayEnvironment, SepayIntegrationStatus } from '../../../shared/payment'
import type { DbOrTx } from '../../db/client'
import { sepayIntegrations } from '../../db/schema'
import { decryptSecret } from '../../utils/crypto'

const ENDPOINT_KEY = /^[A-Za-z0-9_-]{32}$/

/** The only code path that decrypts SePay secrets. Never put the result in a DTO, a log line or an error. */
export async function loadIntegrationSecrets(
  db: DbOrTx,
  integrationId: string,
): Promise<{ hmacSecret: string | null, apiToken: string | null } | null> {
  const [row] = await db
    .select({ hmac: sepayIntegrations.encryptedHmacSecret, token: sepayIntegrations.encryptedApiToken })
    .from(sepayIntegrations)
    .where(eq(sepayIntegrations.id, integrationId))
  if (!row) return null
  return {
    hmacSecret: row.hmac === null ? null : decryptSecret(row.hmac),
    apiToken: row.token === null ? null : decryptSecret(row.token),
  }
}

export async function findIntegrationByEndpointKey(
  db: DbOrTx,
  endpointKey: string,
): Promise<{ id: string, orgId: string, environment: SepayEnvironment, status: SepayIntegrationStatus } | null> {
  if (!ENDPOINT_KEY.test(endpointKey)) return null
  const [row] = await db
    .select({
      id: sepayIntegrations.id,
      orgId: sepayIntegrations.orgId,
      environment: sepayIntegrations.environment,
      status: sepayIntegrations.status,
    })
    .from(sepayIntegrations)
    .where(and(eq(sepayIntegrations.webhookEndpointKey, endpointKey), ne(sepayIntegrations.status, 'DISABLED')))
  return row ?? null
}
