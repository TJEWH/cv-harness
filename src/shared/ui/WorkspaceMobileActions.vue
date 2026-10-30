<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspaceMobileActions } from './workspaceMobileActions';

const props = defineProps<{ active: boolean }>();
const target = useWorkspaceMobileActions();
const destination = computed(() => props.active ? target?.value : null);
</script>

<template>
  <Teleport :to="destination || 'body'" :disabled="!destination"><slot /></Teleport>
</template>
