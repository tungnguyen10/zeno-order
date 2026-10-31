import type { MaybeRefOrGetter } from 'vue'

export function useUnsavedChangesGuard(
  isDirty: MaybeRefOrGetter<boolean>,
  message = 'Bạn có thay đổi chưa lưu. Rời trang?',
): void {
  onBeforeRouteLeave(() => (toValue(isDirty) ? window.confirm(message) : true))

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!toValue(isDirty)) return
    event.preventDefault()
  }

  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
}
