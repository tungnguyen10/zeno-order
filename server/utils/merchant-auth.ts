import type { H3Event } from 'h3'

import { createClient } from '@supabase/supabase-js'
import { createError, getHeader } from 'h3'

export function parseBearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer ([^\s]+)$/)
  return match?.[1] ?? null
}

export function createMerchantSupabaseClient(config: { url: string, key: string, accessToken: string }) {
  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    },
  })
}

export async function requireMerchantClient(event: H3Event) {
  const accessToken = parseBearerToken(getHeader(event, 'authorization'))
  if (!accessToken) throw createError({ statusCode: 401, statusMessage: 'Bạn cần đăng nhập.' })

  const config = useRuntimeConfig(event)
  const client = createMerchantSupabaseClient({
    url: config.public.supabase.url,
    key: config.public.supabase.key,
    accessToken,
  })
  const { data, error } = await client.auth.getUser(accessToken)
  if (error || !data.user) throw createError({ statusCode: 401, statusMessage: 'Phiên đăng nhập không hợp lệ.' })
  return { client, user: data.user }
}
