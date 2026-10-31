import type { MaybeRefOrGetter } from 'vue'

const DEFAULT_MESSAGE = 'Bạn có thay đổi chưa lưu. Rời trang?'

function useUnsavedChangesState() {
  return useState<boolean>('unsaved-changes', () => false)
}

/** For in-page actions that would throw away a dirty form (e.g. switching store): true when it's safe to proceed. */
export function confirmDiscardUnsavedChanges(message = DEFAULT_MESSAGE): boolean {
  const unsaved = useUnsavedChangesState()
  if (!unsaved.value) return true
  if (!window.confirm(message)) return false
  // Discarded: the route-leave guard of the dirty page must not ask a second time.
  unsaved.value = false
  return true
}

export function useUnsavedChangesGuard(
  isDirty: MaybeRefOrGetter<boolean>,
  message = DEFAULT_MESSAGE,
): void {
  const unsaved = useUnsavedChangesState()
  watch(() => toValue(isDirty), (dirty) => {
    unsaved.value = dirty
  }, { immediate: true, flush: 'sync' })

  onBeforeRouteLeave(() => (unsaved.value ? window.confirm(message) : true))

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!unsaved.value) return
    event.preventDefault()
  }

  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onBeforeUnload)
    unsaved.value = false
  })
}
