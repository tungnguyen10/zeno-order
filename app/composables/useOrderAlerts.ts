import { detectNewOrderIds } from '~/utils/order-board'

const SOUND_KEY = 'zeno:board-sound'

export function useOrderAlerts(newOrderIds: Ref<string[]>, resetKey: Ref<string | null>, ready: Ref<boolean> = ref(true)) {
  const toast = useToast()
  const soundOn = ref(true)
  let seen: Set<string> | null = null
  let userActive = false
  let audio: AudioContext | null = null

  const markActive = () => {
    userActive = true
  }

  onMounted(() => {
    try { soundOn.value = localStorage.getItem(SOUND_KEY) !== 'off' }
    catch { /* Sound still works when storage is unavailable. */ }
    window.addEventListener('pointerdown', markActive, { once: true })
    window.addEventListener('keydown', markActive, { once: true })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('pointerdown', markActive)
    window.removeEventListener('keydown', markActive)
    void audio?.close()
  })

  function beep() {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      audio ??= new Ctor()
      void audio.resume()
      const start = audio.currentTime
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, start)
      osc.frequency.setValueAtTime(1175, start + 0.15)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4)
      osc.connect(gain).connect(audio.destination)
      osc.start(start)
      osc.stop(start + 0.45)
    }
    catch {
      // Âm báo là phụ; thiếu WebAudio không được làm hỏng board.
    }
  }

  function toggleSound() {
    markActive()
    soundOn.value = !soundOn.value
    try { localStorage.setItem(SOUND_KEY, soundOn.value ? 'on' : 'off') }
    catch { /* Retain the preference for this visit. */ }
    if (soundOn.value) beep()
  }

  watch(resetKey, () => {
    seen = null
  })

  watch([newOrderIds, ready], ([ids, loaded]) => {
    if (!loaded) return
    const fresh = detectNewOrderIds(seen, ids)
    seen = new Set(ids)
    if (fresh.length === 0) return
    toast.add({ color: 'info', icon: 'i-lucide-bell-ring', title: fresh.length === 1 ? 'Có 1 đơn mới' : `Có ${fresh.length} đơn mới` })
    if (soundOn.value && userActive) beep()
  })

  return { soundOn, toggleSound }
}
