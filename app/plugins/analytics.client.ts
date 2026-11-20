import { sanitizeAnalyticsLocation, sanitizeAnalyticsPath } from '~/utils/analytics-path'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const id = config.public.gaMeasurementId
  const baseUrl = config.public.appBaseUrl

  // Opt-in: no measurement ID means no script, no cookies, no requests.
  if (!id) return
  // Honour Do Not Track as a privacy courtesy.
  if (navigator.doNotTrack === '1' || (window as unknown as { doNotTrack?: string }).doNotTrack === '1') return

  window.dataLayer = window.dataLayer || []
  // gtag must push the raw `arguments` object, not an array, for GA to read it correctly.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  // Disable the automatic page_view: it would send the raw URL, leaking /o/:token and ?t= table tokens.
  window.gtag('config', id, {
    send_page_view: false,
    anonymize_ip: true,
  })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(script)

  const router = useRouter()
  // First load + every SPA navigation, always with a token-free path.
  const sendView = (fullPath: string) => {
    window.gtag!('event', 'page_view', {
      page_path: sanitizeAnalyticsPath(fullPath),
      page_location: sanitizeAnalyticsLocation(baseUrl, fullPath),
    })
  }
  sendView(router.currentRoute.value.fullPath)
  router.afterEach(to => sendView(to.fullPath))
})
