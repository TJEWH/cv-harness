<script setup lang="ts">
import { computed } from 'vue';
import { makeT } from '../../../i18n/dict.ts';

const props = defineProps({
  pages: { type: Array, default: () => [] },
  page: { type: Number, default: 1 },
  lang: { type: String, required: true },
  fullscreen: { type: Boolean, default: false },
});

const emit = defineEmits<{ 'update:page': [page: number] }>();
const langRef = computed(() => props.lang);
const t = makeT(langRef);
const totalPages = computed(() => props.pages.length);
const currentPage = computed(() => Math.min(Math.max(props.page, 1), Math.max(totalPages.value, 1)));
const hasPreviousPage = computed(() => currentPage.value > 1);
const hasNextPage = computed(() => currentPage.value < totalPages.value);

function setPage(nextPage: number) {
  emit('update:page', Math.min(Math.max(nextPage, 1), Math.max(totalPages.value, 1)));
}
</script>

<template>
  <nav class="pdf-pagination" :class="{ 'pdf-pagination--fullscreen': fullscreen }" :aria-label="t('previewPagination')">
    <button class="mini pdf-pagination__button pdf-pagination__button--previous" type="button" :disabled="!hasPreviousPage" :aria-label="t('previousPage')" :title="t('previousPage')" @click="setPage(currentPage - 1)">
      <font-awesome-icon :icon="['fas', 'chevron-left']" />
    </button>
    <output class="pdf-pagination__page-count" aria-live="polite">
      {{ totalPages ? `${t('page')} ${currentPage} ${t('of')} ${totalPages}` : t('previewLoading') }}
    </output>
    <button class="mini pdf-pagination__button pdf-pagination__button--next" type="button" :disabled="!hasNextPage" :aria-label="t('nextPage')" :title="t('nextPage')" @click="setPage(currentPage + 1)">
      <font-awesome-icon :icon="['fas', 'chevron-right']" />
    </button>
  </nav>
</template>

<style scoped>
.pdf-pagination { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; }
.pdf-pagination .mini:disabled { cursor: not-allowed; opacity: .45; }
.pdf-pagination:not(.pdf-pagination--fullscreen) .pdf-pagination__button { width: 52px; height: 44px; padding: 0; font-size: 18px; }
.pdf-pagination__page-count { min-width: 0; color: var(--ui-muted); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: center; }

.pdf-pagination--fullscreen { position: fixed; inset: 0; z-index: 25; display: block; pointer-events: none; }
.pdf-pagination--fullscreen .pdf-pagination__button {
  position: fixed;
  top: 50%;
  z-index: 1;
  width: 52px;
  height: 52px;
  padding: 0;
  border: 1px solid rgba(155, 232, 199, .65);
  border-radius: 50%;
  background: rgba(6, 16, 23, .94);
  box-shadow: 0 8px 20px rgba(0, 0, 0, .42);
  color: #d1fae5;
  font-size: 20px;
  pointer-events: auto;
  transform: translateY(-50%);
  transition: transform .16s ease, background .16s ease, opacity .16s ease;
}
.pdf-pagination--fullscreen .pdf-pagination__button:hover:not(:disabled) { background: #0b2c2b; transform: translateY(-50%) scale(1.06); }
.pdf-pagination--fullscreen .pdf-pagination__button:focus-visible { outline: 2px solid #9be8c7; outline-offset: 3px; }
.pdf-pagination--fullscreen .pdf-pagination__button--previous { left: clamp(12px, calc(50vw - 460px), 56px); }
.pdf-pagination--fullscreen .pdf-pagination__button--next { right: clamp(12px, calc(50vw - 460px), 56px); }
.pdf-pagination--fullscreen .pdf-pagination__page-count {
  position: fixed;
  z-index: 1;
  bottom: 20px;
  left: 50%;
  padding: 6px 10px;
  border: 1px solid #2a3441;
  border-radius: 999px;
  background: rgba(6, 16, 23, .92);
  box-shadow: 0 5px 14px rgba(0, 0, 0, .28);
  pointer-events: none;
  transform: translateX(-50%);
}

@media (max-width: 760px) {
  .pdf-pagination--fullscreen { position: static; display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; width: min(100%, 300px); justify-self: center; }
  .pdf-pagination--fullscreen .pdf-pagination__button { position: static; width: 44px; height: 44px; font-size: 18px; transform: none; }
  .pdf-pagination--fullscreen .pdf-pagination__button:hover:not(:disabled) { transform: none; }
  .pdf-pagination--fullscreen .pdf-pagination__page-count { position: static; justify-self: center; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .pdf-pagination--fullscreen .pdf-pagination__button { transition: none; }
  .pdf-pagination--fullscreen .pdf-pagination__button:hover:not(:disabled) { transform: translateY(-50%); }
}
@media (prefers-reduced-motion: reduce) and (max-width: 760px) {
  .pdf-pagination--fullscreen .pdf-pagination__button:hover:not(:disabled) { transform: none; }
}
</style>
