<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  step?: { current: number, total: number, label: string }
}>()

const slots = defineSlots<{ default?: () => unknown, footer?: () => unknown }>()

const benefits = [
  'Khách quét QR, gọi món không cần app',
  'Thanh toán VietQR tự đối soát',
  'Nhận và xử lý đơn ngay trên điện thoại',
]
</script>

<template>
  <div class="relative min-h-dvh bg-default lg:grid lg:grid-cols-2">
    <aside class="relative hidden overflow-hidden bg-primary p-12 text-(--zeno-on-primary) lg:flex lg:flex-col lg:justify-between">
      <div aria-hidden="true" class="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
      <p class="relative font-display text-2xl font-semibold tracking-tight">
        zeno
      </p>
      <div class="relative flex flex-col gap-8">
        <p class="font-display text-4xl leading-tight font-semibold">
          Đặt món tại bàn,<br>không cần app.
        </p>
        <ul class="flex flex-col gap-3">
          <li v-for="benefit in benefits" :key="benefit" class="flex items-center gap-3">
            <UIcon name="i-lucide-circle-check" class="size-5 shrink-0" />
            <span>{{ benefit }}</span>
          </li>
        </ul>
      </div>
      <p class="relative text-sm opacity-90">
        © ZENO
      </p>
    </aside>

    <main class="relative flex min-h-dvh flex-col overflow-hidden px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
      <div aria-hidden="true" class="pointer-events-none absolute -right-28 -top-28 size-72 rounded-full bg-secondary/25 blur-3xl dark:bg-secondary/10 lg:hidden" />
      <div aria-hidden="true" class="pointer-events-none absolute -bottom-32 -left-24 size-72 rounded-full bg-primary/10 blur-3xl lg:hidden" />

      <header class="relative">
        <AppLogo to="/" />
      </header>

      <div class="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-8">
        <div>
          <p v-if="step" class="mb-2 text-[13px] font-semibold text-primary">
            Bước {{ step.current }}/{{ step.total }} · {{ step.label }}
          </p>
          <h1 class="text-h1 text-default">
            {{ title }}
          </h1>
          <p v-if="description" class="mt-2 text-muted">
            {{ description }}
          </p>
        </div>

        <ZCard variant="raised" padding="lg">
          <slot />
        </ZCard>

        <div v-if="slots.footer" class="text-center text-sm text-muted">
          <slot name="footer" />
        </div>
      </div>
    </main>
  </div>
</template>
