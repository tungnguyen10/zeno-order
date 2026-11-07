import { readFileSync } from 'node:fs'

// CI uses HTTPS to exercise real Secure first-party cookies in WebKit too.
export const browserTls = process.env.CI_BROWSER_TLS === '1'
export const browserBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3100'
export const browserServerEnv = {
  NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3100', AUTH_TEST_JWKS: '',
  ...(browserTls ? {
    NITRO_SSL_CERT: readFileSync('.cache/ci-tls/cert.pem', 'utf8'),
    NITRO_SSL_KEY: readFileSync('.cache/ci-tls/key.pem', 'utf8'),
  } : {}),
}
