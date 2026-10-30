<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Draggable from 'vuedraggable';
import type { CvItem } from '../../../documents/cv/types';
import { makeT } from '../../../i18n/dict';

const props = defineProps<{
  modelValue: CvItem[];
  lang: string;
  reorderMode: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [items: CvItem[]] }>();
const t = makeT(computed(() => props.lang));
const touchReorderMedia = typeof window === 'undefined' ? undefined : window.matchMedia?.('(max-width: 760px), (any-pointer: coarse)');
const touchReorder = ref(touchReorderMedia?.matches ?? false);
const syncTouchReorder = () => { touchReorder.value = touchReorderMedia?.matches ?? false; };
onMounted(() => touchReorderMedia?.addEventListener('change', syncTouchReorder));
onBeforeUnmount(() => touchReorderMedia?.removeEventListener('change', syncTouchReorder));
const items = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const itemLabel = (item: CvItem, index: number) => {
  const values = [item.title, item.name, item.company, item.sub, item.institution, item.place, item.start, item.end]
    .filter((value): value is string => typeof value === 'string' && !!value.trim());
  return values.length ? values.join(' · ') : `${t('item')} ${index + 1}`;
};
const moveItem = (index: number, direction: number, event: KeyboardEvent) => {
  const targetIndex = index + direction;
  if (!props.reorderMode || targetIndex < 0 || targetIndex >= items.value.length) return;
  const row = event.currentTarget as HTMLElement;
  const reordered = [...items.value];
  const [item] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, item);
  items.value = reordered;
  nextTick(() => row.focus());
};
</script>

<template>
  <Draggable v-model="items" item-key="id" :disabled="!reorderMode" :handle="touchReorder ? '.item-drag-handle' : '.item-reorder-row'" :animation="150" class="items section-items" :class="{ 'section-items--touch-reorder': touchReorder }" ghost-class="sortable-ghost" chosen-class="sortable-chosen">
    <template #item="{ element: item, index }: { element: CvItem; index: number }">
      <div class="item-row" :class="{ 'item-row--hidden': item.hidden, 'item-row--reordering': reorderMode }">
        <button v-if="reorderMode" class="item-reorder-row" type="button" :aria-label="`${t('moveEntry')}: ${itemLabel(item, index)}`" :title="t('reorderItemsHelp')" @keydown.up.prevent.stop="moveItem(index, -1, $event)" @keydown.down.prevent.stop="moveItem(index, 1, $event)">
          <span class="item-drag-handle" aria-hidden="true"><font-awesome-icon :icon="['fas', 'grip-vertical']" /></span>
          <span class="item-reorder-label">{{ itemLabel(item, index) }}</span>
        </button>
        <slot v-else :item="item" :index="index" />
      </div>
    </template>
  </Draggable>
</template>

<style scoped>
.section-items { margin-left: 16px; padding-left: 12px; border-left: 1px solid #2a6a60; }
.item-row--reordering { grid-template-columns: minmax(0, 1fr); }
.item-reorder-row { display: flex; align-items: center; width: 100%; min-height: 38px; padding: 0; border: 1px solid #2a6a60; border-radius: 6px; background: #0b2520; color: #d1fae5; font: inherit; text-align: left; overflow-wrap: anywhere; cursor: grab; touch-action: none; }
.item-reorder-label { min-width: 0; padding: 8px 12px; }
.item-drag-handle { display: none; }
.item-reorder-row:hover { background: #134e4a; }
.item-reorder-row:active { cursor: grabbing; }
.item-reorder-row:focus-visible { outline: 2px solid #9be8c7; outline-offset: -2px; }
.section-items--touch-reorder .item-reorder-row { min-height: 46px; cursor: default; touch-action: pan-y; }
.section-items--touch-reorder .item-drag-handle { display: grid; place-items: center; align-self: stretch; flex: 0 0 44px; min-height: 44px; color: var(--ui-accent); cursor: grab; touch-action: none; }
.section-items--touch-reorder .item-drag-handle:active { cursor: grabbing; }
.section-items--touch-reorder .item-reorder-label { padding-left: 4px; }
.sortable-chosen { outline: 1px solid #10b981; }
</style>
