<script setup lang="ts">
definePageMeta({ middleware: 'merchant-auth' })
await navigateTo('/admin/orders')
</script>
