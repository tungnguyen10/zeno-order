<script setup lang="ts">
import ReportsPanel from '~/components/reports/ReportsPanel.vue'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Báo cáo' })
</script>

<template>
  <ReportsPanel />
</template>
