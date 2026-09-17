export function useMerchantApi() {
  const session = useSupabaseSession()

  async function request<T>(url: string, options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    query?: Record<string, string | number | undefined>
    body?: Record<string, unknown> | FormData | null
  } = {}) {
    const token = session.value?.access_token
    if (!token) throw createError({ statusCode: 401, statusMessage: 'Bạn cần đăng nhập.' })
    return $fetch<T>(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  return { request }
}
