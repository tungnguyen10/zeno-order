<script setup lang="ts">
import { TAB_LABELS } from '#shared/order-flow'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })

const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const storeId = computed(() => activeStore.value?.id ?? null)
const role = computed(() => activeStore.value?.role ?? 'STAFF')
const viewPath = computed(() => activeStore.value ? `/s/${activeStore.value.slug}` : '')
const publicUrl = computed(() => (activeStore.value ? `${config.public.appBaseUrl}/s/${activeStore.value.slug}` : ''))

const board = useOrderBoard(storeId)
const { tab, orders, counts, nextCursor, loading, loadingMore, loadError, stale, busyIds } = board
const { soundOn, toggleSound } = useOrderAlerts(board.newOrderIds, storeId, computed(() => board.lastUpdated.value !== null))

const now = ref(Date.now())
useVisiblePolling(() => board.refresh(), { intervalMs: 5000 })
useVisiblePolling(() => {
  now.value = Date.now()
}, { intervalMs: 30_000 })
watch([storeId, tab], () => void board.reload(), { immediate: true })

useHead(() => ({ title: counts.value.new > 0 ? `(${counts.value.new}) Đơn hàng` : 'Đơn hàng' }))

const detailId = ref<string | null>(null)
watch(storeId, () => { detailId.value = null })
const nothingAtAll = computed(() => Object.values(counts.value).every(count => count === 0) && orders.value.length === 0)
const EMPTY: Record<string, string> = {
  new: 'Chưa có đơn mới',
  doing: 'Không có đơn đang làm',
  ready: 'Không có đơn sẵn sàng',
  other: 'Chưa có đơn hoàn tất hoặc đã hủy',
  awaiting_payment: 'Không có đơn chờ thanh toán',
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <AppPageHeader title="Đơn hàng" description="Theo dõi và xử lý đơn của quán.">
      <template #actions>
        <ZButton
          variant="ghost"
          :icon="soundOn ? 'i-lucide-bell' : 'i-lucide-bell-off'"
          :aria-label="soundOn ? 'Tắt âm báo đơn mới' : 'Bật âm báo đơn mới'"
          @click="toggleSound()"
        >
          {{ soundOn ? 'Âm báo bật' : 'Âm báo tắt' }}
        </ZButton>
      </template>
    </AppPageHeader>

    <ZAlert
      v-if="activeStore && !activeStore.isAcceptingOrders"
      color="warning"
      title="Quán đang tạm nghỉ — khách không đặt được món"
    >
      <template #actions>
        <ZButton v-if="role === 'OWNER'" variant="secondary" size="sm" to="/app/settings">
          Bật nhận đơn
        </ZButton>
      </template>
    </ZAlert>

    <AppBoardTabs v-model="tab" :counts="counts" />

    <ZAlert v-if="stale" color="warning" title="Không cập nhật được, đang thử lại…" />

    <div v-if="loading" class="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải đơn">
      <USkeleton v-for="i in 3" :key="i" class="h-44 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="loadError" color="error" title="Không tải được danh sách đơn" :description="loadError">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="board.reload()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else-if="orders.length">
      <ul class="flex flex-col gap-3" :aria-label="TAB_LABELS[tab]">
        <li v-for="order in orders" :key="order.id">
          <AppOrderCard
            :order="order"
            :now="now"
            :busy="busyIds.has(order.id)"
            @advance="status => board.advance(order, status)"
            @mark-paid="board.markPaid(order)"
            @open="detailId = order.id"
          />
        </li>
      </ul>
      <ZButton v-if="nextCursor" variant="secondary" block :loading="loadingMore" @click="board.loadMore()">
        Xem thêm
      </ZButton>
    </template>

    <ZCard v-else variant="raised" padding="lg">
      <AppEmptyState
        icon="i-lucide-receipt"
        :title="nothingAtAll && tab === 'new' ? 'Chưa có đơn hàng nào' : EMPTY[tab]!"
        :description="nothingAtAll && tab === 'new' ? 'Chia sẻ link đặt món để khách bắt đầu gọi món. Đơn mới sẽ hiện ở đây.' : 'Danh sách tự cập nhật mỗi vài giây.'"
      >
        <template v-if="nothingAtAll && tab === 'new'" #actions>
          <AppCopyField v-if="publicUrl" :value="publicUrl" label="Link đặt món" />
          <ZButton v-if="viewPath" variant="secondary" block icon="i-lucide-external-link" :to="viewPath" target="_blank">
            Xem trang khách
          </ZButton>
        </template>
      </AppEmptyState>
    </ZCard>

    <AppOrderDetailSlideover
      v-if="storeId"
      :store-id="storeId"
      :order-id="detailId"
      :role="role"
      @close="detailId = null"
      @changed="board.refresh(true)"
    />
  </div>
</template>
