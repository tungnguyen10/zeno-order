export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  // Registration is cheap and idempotent; the push opt-in happens later from the order board.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration only means push is unavailable; the board still works.
    })
  })
})
