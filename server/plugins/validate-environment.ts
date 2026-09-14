import { parseSupabaseEnvironment } from '../utils/environment'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  parseSupabaseEnvironment({
    url: config.public.supabase.url,
    key: config.public.supabase.key,
  })
})
