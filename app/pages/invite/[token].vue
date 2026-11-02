<script setup lang="ts">
import InvitationPanel from '~/components/team/InvitationPanel.vue'

definePageMeta({ middleware: ['auth'] })
useHead({ title: 'Lời mời tham gia quán' })
</script>

<template>
  <InvitationPanel />
</template>
