<script setup lang="ts">
import TeamPanel from '~/components/team/TeamPanel.vue'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Nhân viên' })
</script>

<template>
  <TeamPanel />
</template>
