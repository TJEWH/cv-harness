/** Deterministic preview failures and recovery; no storage or network calls. */
import { createApp, h, ref } from 'vue';
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faArrowLeft, faChevronLeft, faChevronRight, faDownload, faSpinner } from '@fortawesome/free-solid-svg-icons';
import InlineDocumentPreview from '../../../src/documents/pdf/components/InlineDocumentPreview.vue';
import FullDocumentPreview from '../../../src/documents/pdf/components/FullDocumentPreview.vue';
import PreviewDialog from '../../../src/shared/ui/PreviewDialog.vue';
import AppToaster from '../../../src/shared/ui/AppToaster.vue';
import { dict } from '../../../src/i18n/dict';
import type { PreviewPage } from '../../../src/documents/pdf/pdfTypes';
import '../../../src/assets/cv.css';
library.add(faArrowLeft, faChevronLeft, faChevronRight, faDownload, faSpinner);
const app = createApp({ setup() {
  const error = ref(dict.previewFailed.de), busy = ref(false), expanded = ref(false), longTitle = ref(false);
  const pages = ref<PreviewPage[]>([]);
  const retry = () => {
    error.value = ''; busy.value = true;
    setTimeout(() => {
      pages.value = [{ sourceTop: 0, sourceBottom: 297, canvasWidth: 210, contentWidth: 210, leftOffset: 0, topOffset: 0, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><rect width="210" height="297" fill="white"/><text x="16" y="26" font-family="sans-serif" font-size="12">Vorschau wiederhergestellt</text></svg>' }];
      busy.value = false;
    }, 300);
  };
  return () => h('main', { style: 'max-width:800px;margin:auto;padding:24px;color:#dce6e2;font-family:system-ui' }, [
    h(AppToaster, { lang: 'de' }),
    h('h1', 'Synthetische Vorschauprüfung'),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' }, [
      h('button', { class: 'btn', onClick: () => { error.value = dict.previewFailed.de; pages.value = []; } }, 'Fehler simulieren'),
      h('button', { class: 'btn', onClick: () => { expanded.value = true; } }, 'Vollbild öffnen'),
      h('button', { class: 'btn', onClick: () => { longTitle.value = true; } }, 'Langen Titel prüfen'),
    ]),
    h(InlineDocumentPreview, { pages: pages.value, page: 1, lang: 'de', isUpdating: busy.value, error: error.value, hideActions: true, showOnMobile: true, onRetry: retry }),
    h(FullDocumentPreview, { modelValue: expanded.value, 'onUpdate:modelValue': (value: boolean) => { expanded.value = value; }, pages: pages.value, page: 1, lang: 'de', isUpdating: busy.value, previewError: error.value, downloadDisabled: true, onRetry: retry }),
    h(PreviewDialog, { modelValue: longTitle.value, 'onUpdate:modelValue': (value: boolean) => { longTitle.value = value; }, title: 'WissenschaftlicheVeröffentlichungen'.repeat(6), lang: 'de' }, { default: () => 'Langer Dateiname · Éléonore · 山田 · الباحثة' }),
  ]);
} });
app.component('font-awesome-icon', FontAwesomeIcon);
app.mount('#app');
