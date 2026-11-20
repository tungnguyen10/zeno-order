interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Captures the install prompt early (it can fire before any component mounts) so the
// "Cài đặt ứng dụng" button can trigger it later. Stored in Nuxt state, read by useInstallPrompt.
export default defineNuxtPlugin(() => {
  const deferred = useState<BeforeInstallPromptEvent | null>('pwa:install-prompt', () => null)
  const installed = useState<boolean>('pwa:installed', () => false)

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred.value = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferred.value = null
  })
})
