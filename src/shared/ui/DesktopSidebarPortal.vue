<script setup lang="ts">
import { computed } from 'vue';
import { useDesktopSidebar } from './desktopSidebar';

const props = withDefaults(defineProps<{ area: 'subtabs' | 'major' | 'minor'; active?: boolean }>(), { active: true });
const desktop = useDesktopSidebar();
const inSidebar = computed(() => desktop.value && props.active);
</script>

<template>
  <Teleport defer :to="inSidebar ? `#desktop-sidebar-${area}` : 'body'" :disabled="!inSidebar">
    <slot />
  </Teleport>
</template>
