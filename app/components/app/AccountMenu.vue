<script setup lang="ts">
const { me } = useMe()
const { signOut } = useAuth()
const route = useRoute()

const open = ref(false)
watch(() => route.fullPath, () => { open.value = false })

const name = computed(() => me.value?.user.displayName || me.value?.user.email || '')
const email = computed(() => me.value?.user.email ?? '')
const initial = computed(() => name.value.trim().charAt(0).toUpperCase() || '?')

async function onSignOut() {
  if (!confirmDiscardUnsavedChanges()) return
  try {
    await signOut()
  }
  catch {
    // Local session state is already cleared by signOut(); nothing else to recover.
  }
  finally {
    await navigateTo('/login')
  }
}
</script>

<template>
  <div>
    <div class="md:hidden">
      <UPopover v-model:open="open" :content="{ align: 'end', sideOffset: 8 }" :ui="{ content: 'w-[min(18rem,calc(100vw-2rem))] bg-(--zeno-surface) ring-default' }">
        <button
          type="button"
          aria-label="Tài khoản"
          class="flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span class="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-(--zeno-on-primary)">{{ initial }}</span>
        </button>
        <template #content>
          <div class="flex flex-col gap-3 p-4">
            <div class="min-w-0">
              <p class="truncate font-semibold text-default">{{ name }}</p>
              <p class="truncate text-sm text-muted">{{ email }}</p>
            </div>
            <AppColorModeToggle variant="row" />
            <ZButton variant="secondary" block icon="i-lucide-log-out" @click="onSignOut">
              Đăng xuất
            </ZButton>
          </div>
        </template>
      </UPopover>
    </div>

    <div class="hidden md:flex md:flex-col md:gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-(--zeno-on-primary)">{{ initial }}</span>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-default">{{ name }}</p>
          <p class="truncate text-[13px] text-muted">{{ email }}</p>
        </div>
      </div>
      <AppColorModeToggle variant="row" />
      <ZButton variant="ghost" block icon="i-lucide-log-out" class="justify-start" @click="onSignOut">
        Đăng xuất
      </ZButton>
    </div>
  </div>
</template>
