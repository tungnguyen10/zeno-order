import { createClient } from '@supabase/supabase-js'

interface PublicSupabaseConfig {
  url: string
  key: string
}

export function createPublicSupabaseClient(config: PublicSupabaseConfig) {
  return createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })
}
