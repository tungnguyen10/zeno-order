export interface VisiblePollingOptions {
  intervalMs: number
  enabled?: () => boolean
}

/** Refresh only while mounted, visible and enabled, without overlapping requests. */
export function useVisiblePolling(task: () => Promise<void> | void, { intervalMs, enabled = () => true }: VisiblePollingOptions) {
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false
  let mounted = false

  function stop() {
    clearInterval(timer)
    timer = undefined
  }

  async function tick() {
    if (!mounted || running || !enabled() || document.visibilityState !== 'visible') return
    running = true
    try {
      await task()
    }
    catch {
      // A transient refresh failure must not stop later polling or reject an event handler.
    }
    finally {
      running = false
    }
  }

  function start() {
    stop()
    if (!mounted || !enabled() || document.visibilityState !== 'visible') return
    timer = setInterval(() => {
      if (!enabled()) stop()
      else void tick()
    }, intervalMs)
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      void tick()
      start()
    }
    else stop()
  }

  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    void tick()
    start()
  })
  onBeforeUnmount(() => {
    mounted = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stop()
  })
  watch(() => enabled(), () => {
    start()
    void tick()
  })
}
