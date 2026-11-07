/* eslint-disable @typescript-eslint/no-explicit-any */
import { inject } from 'vitest'
import type { ProductionContext } from './production-server'
import { createSharedAuth } from './shared-auth'

declare module 'vitest' { export interface ProvidedContext { production: ProductionContext } }
export const context = () => inject('production')
process.env.APP_ENCRYPTION_KEY = context().appEncryptionKey
export const signer = () => createSharedAuth(context().keys)
export async function api(method: string, path: string, opts: { token?: string, body?: unknown, headers?: Record<string, string> } = {}) {
  const headers = { ...opts.headers, ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body)
  const res = await fetch(context().baseUrl + path, { method, body, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, redirect: 'manual' })
  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) }
  catch { json = null }
  return { status: res.status, headers: res.headers, text, json }
}
