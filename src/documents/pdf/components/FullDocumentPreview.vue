<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DocumentPreviewPage } from '../pdfTypes';
import { makeT } from '../../../i18n/dict';
import PdfPreview from './PdfPreview.vue';
import PdfPagination from './PdfPagination.vue';

const props = withDefaults(defineProps<{
  modelValue: boolean; pages: DocumentPreviewPage[]; page: number; isUpdating?: boolean; lang: string;
  mode?: string; modes?: { value: string; label: string }[];
  downloading?: boolean; downloadDisabled?: boolean; downloadLabel?: string; title?: string; error?: string;
  previewError?: string;
}>(), { isUpdating: false, mode: 'normal', modes: () => [], downloading: false, downloadDisabled: false, downloadLabel: '', title: '', error: '' });
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; 'update:page': [value: number]; 'update:mode': [value: string]; download: []; retry: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const mobileViewport = window.matchMedia('(max-width: 760px)');
const touchViewport = window.matchMedia('(any-pointer: coarse)');
const mobile = ref(mobileViewport.matches);
const touchInput = ref(touchViewport.matches);
const syncViewport = () => { mobile.value = mobileViewport.matches; };
const syncTouchInput = () => { touchInput.value = touchViewport.matches; };
const t = makeT(computed(() => props.lang));
const showPdf = computed(() => mobile.value || props.mode !== 'html');
const mobileModes = computed(() => props.modes.filter(({ value }) => value !== 'html'));
const currentMobileMode = computed(() => mobileModes.value.find(({ value }) => value === props.mode) || mobileModes.value[0]);
function nextMode() {
  const index = mobileModes.value.findIndex(({ value }) => value === currentMobileMode.value?.value);
  const next = mobileModes.value[(index + 1) % mobileModes.value.length];
  if (next) emit('update:mode', next.value);
}
watch([() => props.modelValue, dialog], ([open, element]) => {
  if (!element) return;
  if (open && !element.open) element.showModal();
  else if (!open && element.open) element.close();
}, { flush: 'post' });
onMounted(() => {
  mobileViewport.addEventListener('change', syncViewport);
  touchViewport.addEventListener('change', syncTouchInput);
});
onBeforeUnmount(() => {
  mobileViewport.removeEventListener('change', syncViewport);
  touchViewport.removeEventListener('change', syncTouchInput);
});
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="document-full-preview" :class="{ 'document-full-preview--pdf': showPdf }" :aria-label="title || t('liveCvPreview')" @close="emit('update:modelValue', false)">
      <template v-if="modelValue">
        <div class="document-full-preview__toolbar">
          <button class="btn document-full-preview__back" type="button" :aria-label="t('backToBuilder')" autofocus @click="emit('update:modelValue', false)">
            <font-awesome-icon :icon="['fas', 'arrow-left']" aria-hidden="true" />
            <span>{{ t('backToBuilder') }}</span>
          </button>
          <div class="document-full-preview__actions">
            <button v-if="mobile && mobileModes.length > 1" class="btn" type="button" :aria-label="t(mode === 'anonymized' ? 'showNormalPreview' : 'showAnonymizedPreview')" :aria-pressed="mode === 'anonymized'" @click="nextMode">
              <font-awesome-icon :icon="['fas', mode === 'anonymized' ? 'user-secret' : 'eye']" aria-hidden="true" />
              <span>{{ t(mode === 'anonymized' ? 'privacyPreview' : 'normalPreview') }}</span>
            </button>
            <select v-else-if="!mobile && modes.length > 1" :value="mode" :aria-label="t('previewFormat')" @change="emit('update:mode', ($event.target as HTMLSelectElement).value)">
              <option v-for="item in modes" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
            <button class="btn btn--primary" type="button" :aria-label="downloadLabel || t(downloading ? 'exportingPdf' : 'downloadPdf')" :title="downloadLabel || undefined" :disabled="downloading || downloadDisabled" @click="emit('download')">
              <font-awesome-icon :icon="['fas', downloading ? 'spinner' : 'download']" :spin="downloading" aria-hidden="true" />
              <span>{{ downloadLabel || t(downloading ? 'exportingPdf' : 'downloadPdf') }}</span>
            </button>
          </div>
        </div>
        <div class="document-full-preview__content" :class="{ 'document-full-preview__content--with-header': !!$slots.header }">
          <div v-if="$slots.header" class="document-full-preview__header"><slot name="header" /></div>
          <div class="document-full-preview__viewport">
            <PdfPreview v-if="showPdf" :key="mode" :pages="pages" :page="page" :is-updating="isUpdating" :error="previewError" :lang="lang" gesture-navigation :pinch-zoom="mobile || touchInput" @retry="emit('retry')" @update:page="emit('update:page', $event)" />
            <div v-else class="document-full-preview__html"><slot name="html" /></div>
          </div>
        </div>
        <PdfPagination v-if="showPdf && pages.length && !previewError" class="document-full-preview__pagination" :pages="pages" :page="page" :lang="lang" fullscreen @update:page="emit('update:page', $event)" />
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.document-full-preview{position:fixed;inset:0;width:100%;height:100dvh;max-width:none;max-height:none;margin:0;padding:84px 16px 64px;border:0;border-radius:0;box-sizing:border-box;color:#d1fae5;background:#050d14;font-family:var(--font-ui,system-ui);overflow:auto;overscroll-behavior:contain}
.document-full-preview[open]{display:flex;justify-content:center}
.document-full-preview::backdrop{background:#050d14}
.document-full-preview__content{width:min(100%,860px);min-width:0;margin:auto;align-self:flex-start;display:grid;justify-items:center}
.document-full-preview__content--with-header{grid-template-rows:auto minmax(0,1fr);gap:12px}
.document-full-preview__header{width:100%;min-width:0;max-height:30dvh;overflow:auto;overflow-wrap:anywhere;padding:10px 12px;box-sizing:border-box;border:1px solid #28534e;border-radius:8px;background:#091923}
.document-full-preview__header p{margin:0}
.document-full-preview__viewport{width:100%;min-width:0;display:grid;justify-items:center}
.document-full-preview__html{width:min(100%,210mm);overflow:auto;background:#fff}
.document-full-preview__back,.document-full-preview__actions{position:fixed;top:20px;z-index:30}
.document-full-preview__back{left:20px;display:inline-flex;align-items:center;gap:8px}
.document-full-preview__actions{right:20px;display:flex;flex-direction:column;gap:8px;align-items:stretch}
.document-full-preview__actions select{min-height:36px;font:inherit;color:#d1fae5;background:#0b1b25;border:1px solid #28534e;border-radius:7px;padding:6px 10px}
.document-full-preview__actions .btn{display:flex;justify-content:center;align-items:center;gap:8px}
.document-full-preview--pdf{padding-block:0;overflow:hidden}
.document-full-preview--pdf .document-full-preview__content{width:100%;height:100%;min-height:0;margin:0;overflow:hidden}
.document-full-preview--pdf .document-full-preview__content--with-header{padding-top:84px;box-sizing:border-box}
.document-full-preview--pdf .document-full-preview__header{width:min(100%,860px)}
.document-full-preview--pdf .document-full-preview__viewport{container-type:size;height:100%;min-height:0;overflow:hidden}
.document-full-preview--pdf :deep(.pdf-preview),.document-full-preview--pdf :deep(.pdf-preview__stage){height:100%;min-height:0}
.document-full-preview--pdf :deep(.pdf-preview__stage){background:transparent}
.document-full-preview--pdf :deep(.pdf-preview__page){width:min(100cqw,calc(100cqh * var(--pdf-page-ratio, 0.7070707)))}
@media(max-width:760px){
  .document-full-preview{padding:max(8px,env(safe-area-inset-top,0px)) max(8px,env(safe-area-inset-right,0px)) max(8px,env(safe-area-inset-bottom,0px)) max(8px,env(safe-area-inset-left,0px));overflow:hidden}
  .document-full-preview[open]{display:grid;grid-template-rows:auto minmax(0,1fr) 52px;gap:8px;justify-content:stretch}
  .document-full-preview__toolbar{display:flex;gap:8px;min-width:0}
  .document-full-preview__back{position:static;flex:0 0 44px;justify-content:center;padding:6px}
  .document-full-preview__back span{display:none}
  .document-full-preview__actions{position:static;display:flex;flex:1;flex-direction:row;gap:8px;min-width:0}
  .document-full-preview__actions .btn{flex:1;min-width:0;min-height:44px;padding:6px;font-size:clamp(11px,3vw,13px);line-height:1.2}
  .document-full-preview__actions .svg-inline--fa{flex:none;margin:0;font-size:16px}
  .document-full-preview__content{width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;margin:0}
  .document-full-preview--pdf .document-full-preview__content--with-header{padding-top:0}
}
</style>
