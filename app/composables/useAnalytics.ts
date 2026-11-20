import { sanitizeAnalyticsLocation, sanitizeAnalyticsPath } from '../utils/analytics-path'

type GtagParams = Record<string, string | number | boolean | undefined>

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gtag?: (...args: any[]) => void
    dataLayer?: unknown[]
  }
}

/**
 * Thin, privacy-safe wrapper over gtag. Every method no-ops when GA is disabled or absent, so callers
 * never need to guard. Never pass PII (names, phones, addresses, order/guest tokens) in params.
 */
export function useAnalytics() {
  const config = useRuntimeConfig()
  const id = config.public.gaMeasurementId
  const baseUrl = config.public.appBaseUrl

  const enabled = () => import.meta.client && !!id && typeof window.gtag === 'function'

  function pageView(fullPath: string): void {
    if (!enabled()) return
    window.gtag!('event', 'page_view', {
      page_path: sanitizeAnalyticsPath(fullPath),
      page_location: sanitizeAnalyticsLocation(baseUrl, fullPath),
    })
  }

  function track(event: string, params: GtagParams = {}): void {
    if (!enabled()) return
    window.gtag!('event', event, params)
  }

  return { enabled, pageView, track }
}
