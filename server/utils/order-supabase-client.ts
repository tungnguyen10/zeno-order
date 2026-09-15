import { createClient } from '@supabase/supabase-js'

export function createOrderSupabaseClient(config: { url: string, secretKey: string }) {
  return createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}
