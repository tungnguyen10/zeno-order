<script setup lang="ts">
const items = [
  { name: 'Trà sữa trân châu', price: '35.000đ' },
  { name: 'Cà phê muối', price: '29.000đ' },
  { name: 'Trà đào cam sả', price: '32.000đ' },
]
</script>

<template>
  <div aria-hidden="true" class="relative mx-auto w-full max-w-[17.5rem] select-none lg:max-w-xs">
    <div class="absolute -inset-4 rounded-[3rem] bg-secondary/25 blur-2xl dark:bg-secondary/10" />
    <div class="relative rounded-[2.5rem] bg-coffee-900 p-2.5 shadow-lg dark:bg-black dark:ring-1 dark:ring-default">
      <div class="overflow-hidden rounded-[2rem] bg-default">
        <div class="flex items-center justify-between px-5 pb-3 pt-6">
          <div>
            <p class="text-[11px] text-muted">Bàn 05</p>
            <p class="font-display text-lg font-semibold text-default">Trà Sữa Mây</p>
          </div>
          <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200">Đang mở</span>
        </div>
        <div class="flex gap-2 px-5 pb-3 text-[11px] font-medium">
          <span class="rounded-full bg-primary px-3 py-1 text-(--zeno-on-primary)">Trà sữa</span>
          <span class="rounded-full bg-(--zeno-surface-hover) px-3 py-1 text-primary">Cà phê</span>
          <span class="rounded-full bg-(--zeno-surface-hover) px-3 py-1 text-primary">Trái cây</span>
        </div>
        <ul class="flex flex-col gap-2.5 px-4 pb-4">
          <li v-for="item in items" :key="item.name" class="flex items-center gap-3 rounded-2xl bg-(--zeno-surface) p-2.5 shadow-sm">
            <div class="size-12 shrink-0 rounded-xl bg-linear-to-br from-secondary/70 to-primary/70" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] font-medium text-default">{{ item.name }}</p>
              <p class="font-mono text-xs text-primary">{{ item.price }}</p>
            </div>
            <span class="flex size-7 items-center justify-center rounded-full bg-primary text-(--zeno-on-primary)">
              <UIcon name="i-lucide-plus" class="size-4" />
            </span>
          </li>
        </ul>
        <div class="mx-4 mb-5 flex items-center justify-between rounded-2xl bg-primary px-4 py-3 text-(--zeno-on-primary)">
          <span class="text-[13px] font-medium">2 món · Xem giỏ</span>
          <span class="font-mono text-[13px] font-semibold">64.000đ</span>
        </div>
      </div>
    </div>
    <div class="absolute -left-10 bottom-24 hidden rounded-2xl bg-(--zeno-surface) p-3 text-center shadow-md sm:block dark:ring-1 dark:ring-default">
      <UIcon name="i-lucide-qr-code" class="size-10 text-default" />
      <p class="mt-1 text-[11px] font-medium text-muted">Quét để gọi món</p>
    </div>
  </div>
</template>
