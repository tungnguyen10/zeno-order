interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** PWA install affordance: a one-tap prompt where supported (Chromium), an iOS hint otherwise. */
export function useInstallPrompt() {
  const deferred = useState<BeforeInstallPromptEvent | null>('pwa:install-prompt', () => null)
  const installed = useState<boolean>('pwa:installed', () => false)

  const standalone = ref(false)
  const isIos = ref(false)

  onMounted(() => {
    standalone.value = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true
    isIos.value = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
  })

  // Chromium: one-tap install available.
  const canPrompt = computed(() => !installed.value && !standalone.value && deferred.value !== null)
  // iOS Safari has no prompt event; show the "Add to Home Screen" hint instead.
  const showIosHint = computed(() => !installed.value && !standalone.value && isIos.value && deferred.value === null)

  async function install(): Promise<boolean> {
    const event = deferred.value
    if (!event) return false
    await event.prompt()
    const choice = await event.userChoice
    deferred.value = null
    if (choice.outcome === 'accepted') installed.value = true
    return choice.outcome === 'accepted'
  }

  return { canPrompt, showIosHint, standalone, install }
}
