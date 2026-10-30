<script setup lang="ts">
defineProps<{
  title?: string;
  collapsed: boolean;
  controls: string;
  editing?: boolean;
  editLabel?: string;
  disabled?: boolean;
}>();
defineEmits<{ activate: []; 'toggle-collapse': [] }>();
</script>

<template>
  <h3 class="section-name-label" :class="{ 'section-name-label--static': !editing }">
    <button v-if="editing && !disabled" class="section-collapse-button" type="button" :aria-expanded="!collapsed" :aria-controls="controls" :aria-label="title" @click.stop="$emit('toggle-collapse')" />
    <slot name="title">
    <span v-if="disabled">{{ title }}</span>
    <button
      v-else
      :id="`${controls}-heading`"
      class="section-heading-button"
      type="button"
      :title="title"
      :aria-expanded="editing ? undefined : !collapsed"
      :aria-controls="editing ? undefined : controls"
      :aria-label="editing ? `${editLabel}: ${title}` : undefined"
      @click.stop="$emit('activate')"
    >{{ title }}</button>
    </slot>
  </h3>
</template>

<style scoped>
.section-name-label { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.section-heading-button { position: relative; z-index: 1; display: block; width: max-content; max-width: 100%; min-width: 0; padding: 5px 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: inherit; font: inherit; text-align: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.section-name-label:not(.section-name-label--static) .section-heading-button:hover { border-color: var(--ui-divider); background: var(--ui-control); }
/* The row remains a keyboard-accessible collapse target without a visible prefix. */
.section-collapse-button { position: absolute; inset: 0; z-index: 0; width: 100%; padding: 0; border: 0; border-radius: 4px; background: transparent; cursor: pointer; }
.section-heading-button:focus-visible, .section-collapse-button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
@media (max-width: 760px), (max-width: 960px) and (max-height: 500px) and (pointer: coarse) { .section-heading-button { min-height: 44px; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; } }
</style>
