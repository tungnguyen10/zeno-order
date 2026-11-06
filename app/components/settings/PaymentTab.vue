<script setup lang="ts">
import { PAYMENT_STEP_TITLES } from '~/utils/payment-readiness'
const props = defineProps<{ storeId: string, orgId: string }>()

const { account, integration, check, loading, loadFailed, busy, fieldErrors, load, runCheck, confirm, connect, link, saveSecret, activate, setAuthMode }
  = usePaymentSetup({ storeId: () => props.storeId, orgId: () => props.orgId })
const readiness = computed(() => paymentReadiness(account.value, integration.value))

onMounted(load)
watch(() => [props.storeId, props.orgId], load)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="loading && !account && !integration" class="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải thanh toán">
      <USkeleton v-for="i in 2" :key="i" class="h-40 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="loadFailed" color="error" title="Không tải được cài đặt thanh toán">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="load()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else>
      <ZAlert :color="readiness.ready ? 'success' : 'info'" :title="PAYMENT_STEP_TITLES[readiness.step]" />
      <SettingsPaymentAccountCard
        :account="account"
        :check="check"
        :busy="busy"
        :field-errors="fieldErrors"
        @check="runCheck"
        @confirm="confirm"
      />
      <SettingsSepayCard
        :integration="integration"
        :step="readiness.step"
        :busy="busy"
        @connect="connect"
        @save-secret="saveSecret"
        @auth-mode="setAuthMode"
        @link="link"
        @activate="activate"
        @refresh="load"
      />
    </template>
  </div>
</template>
