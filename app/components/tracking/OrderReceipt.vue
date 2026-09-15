<script setup lang="ts">
import type { PublicOrderTracking } from '../../../shared/types/tracking'

defineProps<{ order: PublicOrderTracking }>()

const statusLabels: Record<PublicOrderTracking['status'], string> = {
  pending: 'Đã nhận đơn',
  confirmed: 'Đã xác nhận',
  preparing: 'Đang chuẩn bị',
  ready: 'Đã sẵn sàng',
  delivering: 'Đang giao',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
}
</script>

<template>
  <article class="space-y-5">
    <header class="rounded-[var(--radius-card)] bg-[rgb(var(--brand))] p-6 text-white shadow-[var(--shadow-card)]">
      <p class="text-sm font-bold text-blue-100">Đơn {{ order.orderNumber }}</p>
      <h1 class="mt-2 text-3xl font-black">{{ statusLabels[order.status] }}</h1>
      <p class="mt-2 text-sm text-blue-100">Cập nhật {{ new Date(order.updatedAt).toLocaleString('vi-VN') }}</p>
    </header>

    <section class="rounded-[var(--radius-card)] border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-5">
      <h2 class="text-lg font-black">Chi tiết món</h2>
      <ul class="mt-3 divide-y divide-[rgb(var(--border))]">
        <li v-for="item in order.items" :key="`${item.name}-${item.lineTotal}`" class="py-4">
          <div class="flex justify-between gap-4 font-bold">
            <span>{{ item.quantity }} × {{ item.name }}</span>
            <span>{{ formatMoney(item.lineTotal, order.totals.currency) }}</span>
          </div>
          <p v-for="option in item.options" :key="`${option.groupName}-${option.name}`" class="mt-1 text-sm text-[rgb(var(--muted))]">
            {{ option.groupName }}: {{ option.name }}
          </p>
          <p v-if="item.note" class="mt-1 text-sm text-[rgb(var(--muted))]">Ghi chú: {{ item.note }}</p>
        </li>
      </ul>
      <div class="mt-3 flex justify-between border-t border-[rgb(var(--border))] pt-4 text-xl font-black">
        <span>Tổng cộng</span>
        <span>{{ formatMoney(order.totals.total, order.totals.currency) }}</span>
      </div>
    </section>
  </article>
</template>
