import { neonConfig } from '@neondatabase/serverless'

// Behind a corporate HTTP proxy, Node cannot open the Neon driver's WebSocket directly.
// When a proxy is configured, route the driver's WebSocket through it via HTTP CONNECT.
// No proxy env (normal serverless/production) → this is a no-op and the platform WebSocket is used.
export default defineNitroPlugin(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (!proxy) return

  const [{ default: WebSocket }, { HttpsProxyAgent }] = await Promise.all([
    import('ws'),
    import('https-proxy-agent'),
  ])
  const agent = new HttpsProxyAgent(proxy)
  neonConfig.webSocketConstructor = class extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, { agent })
    }
  } as unknown as typeof neonConfig.webSocketConstructor
})
