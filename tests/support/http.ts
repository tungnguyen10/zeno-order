import { fetch } from '@nuxt/test-utils/e2e'

export interface CallResult {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  headers: Headers
}

function authHeaders(token?: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function call(method: string, path: string, token?: string | null, body?: unknown): Promise<CallResult> {
  const headers = authHeaders(token)
  let payload: string | undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const res = await fetch(path, { method, headers, body: payload })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}

export async function callForm(method: string, path: string, token: string | null, form: FormData): Promise<CallResult> {
  const res = await fetch(path, { method, headers: authHeaders(token), body: form })
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
}
