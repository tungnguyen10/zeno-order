import type { MeResponse } from '#shared/types/identity'

export function useMe() {
  const me = useState<MeResponse | null>('me', () => null)
  const api = useApi()

  async function load(force = false): Promise<MeResponse> {
    if (me.value && !force) return me.value
    me.value = await api<MeResponse>('/api/me')
    return me.value
  }

  return { me, load }
}
