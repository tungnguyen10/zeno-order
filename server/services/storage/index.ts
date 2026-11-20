import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { requireEnv } from '../../utils/env'

export const PRODUCT_IMAGES_BUCKET = 'product-images'
export const PRIVATE_ASSETS_BUCKET = 'assets'

let client: S3Client | undefined

// Behind a corporate HTTP proxy, the AWS SDK won't reach object storage unless its requests
// tunnel through the proxy. No proxy env (normal production) → the default handler is used.
function proxyRequestHandler(): NodeHttpHandler | undefined {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (!proxy) return undefined
  return new NodeHttpHandler({ httpsAgent: new HttpsProxyAgent(proxy) })
}

function getClient(): S3Client {
  client ??= new S3Client({
    region: requireEnv('AWS_REGION'),
    endpoint: requireEnv('AWS_ENDPOINT_URL_S3'),
    // Neon Object Storage only supports path-style addressing.
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
    },
    requestHandler: proxyRequestHandler(),
  })
  return client
}

export function publicObjectUrl(bucket: string, key: string): string {
  const base = requireEnv('AWS_ENDPOINT_URL_S3').replace(/\/+$/, '')
  const path = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/${encodeURIComponent(bucket)}/${path}`
}

export async function putObject(input: {
  bucket: string
  key: string
  body: Uint8Array
  contentType: string
  cacheControl?: string
}): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: input.cacheControl,
  }))
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
