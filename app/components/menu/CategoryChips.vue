<script setup lang="ts">
defineProps<{ items: { id: string | null, name: string, imageUrl?: string | null }[] }>()
const emit = defineEmits<{ select: [id: string | null] }>()
const active = ref<string | null | undefined>(undefined)

function pick(id: string | null) {
  active.value = id
  emit('select', id)
}
</script>

<template>
  <nav aria-label="Danh mục" class="sticky top-0 z-10 -mx-4 bg-default/95 px-4 py-2 backdrop-blur">
    <ul class="flex gap-2 overflow-x-auto">
      <li v-for="item in items" :key="item.id ?? 'other'" class="shrink-0">
        <button
          type="button"
          class="flex min-h-11 items-center gap-2 rounded-full pr-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary"
          :class="[
            active === item.id ? 'bg-primary text-(--zeno-on-primary)' : 'bg-(--zeno-surface) text-default ring-1 ring-default',
            item.imageUrl ? 'pl-1 pr-4' : 'px-4',
          ]"
          :aria-current="active === item.id ? 'true' : undefined"
          @click="pick(item.id)"
        >
          <img v-if="item.imageUrl" :src="item.imageUrl" alt="" width="36" height="36" class="size-9 shrink-0 rounded-full object-cover">
          {{ item.name }}
        </button>
      </li>
    </ul>
  </nav>
</template>
