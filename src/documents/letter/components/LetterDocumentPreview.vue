<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { CvState } from '../../cv/types';
import type { LetterContent, LetterFormatting } from '../letterTypes';
import { resolveDesign } from '../../cv/defaults';
import { applyCvDesign } from '../../cv/composables/useCvDesign';
import { useDocumentPdfPreview } from '../../pdf/composables/useDocumentPdfPreview';
import { useToastWatch } from '../../../shared/ui/useToasts';
import { resolveLetterContent, unresolvedLetterPlaceholders } from '../motivationLetters';
import { resolveLetterFormatting } from '../domain/letterFormatting';
import { resolveLetterContact } from '../domain/letterContact';
import { letterClosingSignature, letterParagraphGroups } from '../domain/letterLayout';
import CvContact from '../../cv/components/CvContact.vue';
import InlineDocumentPreview from '../../pdf/components/InlineDocumentPreview.vue';
import FullDocumentPreview from '../../pdf/components/FullDocumentPreview.vue';

const props = withDefaults(defineProps<{
  cvState: CvState | null; content: LetterContent; formatting?: LetterFormatting; previewKey?: string; active?: boolean; lang?: string;
  hideActions?: boolean; downloadDisabled?: boolean; downloading?: boolean; downloadError?: string;
}>(), { active: true, lang: '', downloadDisabled: false, downloading: false, downloadError: '' });
const emit = defineEmits<{ download: [] }>();
const page = ref<HTMLElement | null>(null);
const expanded = ref(false);
const previewLang = computed(() => props.lang || props.cvState?.lang || 'en');
const title = computed(() => previewLang.value === 'de' ? 'Motivationsschreiben' : 'Motivation letter');
const design = computed(() => resolveDesign(props.cvState?.design));
const formatting = computed(() => resolveLetterFormatting(props.formatting));
const contact = computed(() => props.cvState ? resolveLetterContact(props.cvState.contact, props.cvState.design.letterContactFields) : null);
const showSender = computed(() => props.cvState && !props.cvState.disabled.includes('header') && contact.value && Object.values(contact.value).some(value => value.trim()));
const hasTitle = computed(() => contact.value && Boolean(contact.value.name || contact.value.role));
const hasContactDetails = computed(() => (['location', 'email', 'phone', 'website', 'linkedin', 'github'] as const).some(key => contact.value?.[key]));
const resolved = computed(() => resolveLetterContent(props.content, props.cvState?.contact || null));
const groups = computed(() => letterParagraphGroups(resolved.value).map(group => ({
  ...group, signature: letterClosingSignature(group, props.cvState?.contact.name || ''),
})));
const needsSignature = computed(() => !!resolved.value.body.trim() && !groups.value.some(group => group.kind === 'closing'));
const sections = computed(() => {
  const renderedGroups = [...groups.value];
  if (needsSignature.value) renderedGroups.push({
    kind: 'closing', paragraphs: [],
    signature: { signOff: '', signatureParagraphs: props.cvState?.contact.name ? [props.cvState.contact.name] : [] },
  });
  const sections: (typeof renderedGroups)[] = [];
  for (const group of renderedGroups) {
    const previous = sections.at(-1);
    // Keep the final paragraph with the sign-off and signature when they fit.
    if (group.kind === 'closing' && previous?.at(-1)?.kind === 'body') previous.push(group);
    else sections.push([group]);
  }
  return sections;
});
const margins = computed(() => Array(4).fill(formatting.value.marginMm) as number[]);
const pageStyle = computed(() => ({
  '--letter-body-size': `${formatting.value.fontSizePt}pt`,
  '--letter-header-name-size': `${formatting.value.headerNameSizePt}pt`,
  '--letter-line-height': formatting.value.lineHeight,
  width: `${210 - margins.value[1] - margins.value[3]}mm`,
  minHeight: `${297 - margins.value[0] - margins.value[2]}mm`,
}));
function applyDesign() {
  if (!page.value) return;
  // Letters have no CV sidebar or footer; keep those contact layouts beside the sender.
  applyCvDesign({ ...props.cvState?.design, contactLayout: design.value.contactLayout === 'below' ? 'below' : 'side' }, page.value);
}
watch(() => props.cvState?.design, applyDesign, { deep: true, flush: 'post' });
async function element() {
  await nextTick();
  if (!page.value) throw new Error('The motivation letter is unavailable.');
  applyDesign();
  return page.value;
}
const { pages, page: previewPage, busy, error, getPdfBlob: renderPdfBlob } = useDocumentPdfPreview({
  source: element, options: () => ({ margin: margins.value }),
  signature: () => [props.cvState, props.content, props.formatting], active: () => props.active,
  identity: () => [props.previewKey],
});
useToastWatch(() => error.value, { tone: 'error' });
watch(() => props.active, (active) => { if (!active) expanded.value = false; });
async function getPdfBlob(): Promise<Blob> {
  if (!props.cvState) throw new Error('Assign a CV before exporting the motivation letter.');
  if (!props.content.body.trim()) throw new Error('The motivation letter is empty.');
  if (unresolvedLetterPlaceholders(props.content, props.cvState.contact).length) throw new Error('Resolve the letter placeholders before exporting.');
  return renderPdfBlob();
}
defineExpose({ getPdfBlob, getRenderElement: () => page.value, open: () => { expanded.value = true; } });
</script>

<template>
  <div class="letter-preview">
    <InlineDocumentPreview :hide-actions="hideActions" :pages="pages" v-model:page="previewPage" :is-updating="busy" :lang="previewLang" :title="title" :download-disabled="downloadDisabled" :downloading="downloading" @open="expanded = true" @download="emit('download')">
      <template v-if="$slots.default" #header><slot /></template>
    </InlineDocumentPreview>
    <FullDocumentPreview v-model="expanded" v-model:page="previewPage" :pages="pages" :is-updating="busy" :lang="previewLang" :title="title" :error="downloadError || error" :download-disabled="downloadDisabled" :downloading="downloading" @download="emit('download')">
      <template v-if="$slots.default" #header><slot /></template>
    </FullDocumentPreview>
    <div class="letter-preview__source" aria-hidden="true">
      <article ref="page" class="motivation-letter cv-design-scope" :style="pageStyle">
        <header v-if="showSender || resolved.subject" class="letter-header" :class="{ header: showSender, 'letter-header--single': !hasTitle || !hasContactDetails }">
          <template v-if="showSender && contact">
            <div v-if="hasTitle" class="title">
              <h1 v-if="contact.name" class="name">{{ contact.name }}</h1>
              <p v-if="contact.role" class="role">{{ contact.role }}</p>
            </div>
            <CvContact v-if="hasContactDetails" :contact="contact" />
          </template>
          <h2 v-if="resolved.subject" class="letter-subject">{{ resolved.subject }}</h2>
        </header>
        <div v-for="(section, sectionIndex) in sections" :key="sectionIndex" class="letter-section">
        <section v-for="(group, index) in section" :key="index" class="letter-group" :class="`letter-group--${group.kind}`">
          <template v-if="group.signature">
            <p v-if="group.signature.signOff" class="letter-paragraph">{{ group.signature.signOff }}</p>
            <div class="letter-signature-line" aria-hidden="true" />
            <p v-for="(paragraph, paragraphIndex) in group.signature.signatureParagraphs" :key="paragraphIndex" class="letter-signature-name">{{ paragraph }}</p>
          </template>
          <template v-else>
            <p v-for="(paragraph, paragraphIndex) in group.paragraphs" :key="paragraphIndex" class="letter-paragraph">{{ paragraph }}</p>
            <div v-if="group.kind === 'closing'" class="letter-signature-line" aria-hidden="true" />
          </template>
        </section>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.letter-preview{min-width:0;min-height:0;height:100%;overflow:hidden}
.letter-preview__source{position:fixed;left:-20000px;top:0;width:210mm;pointer-events:none}
@media(max-width:760px),(max-width:1180px) and (max-height:600px){.letter-preview{height:auto;flex:0 0 auto}}
.motivation-letter{font:var(--letter-body-size)/var(--letter-line-height) var(--font-body);color:var(--ink);background:white;overflow-wrap:anywhere;text-align:left}
.letter-header{font:10pt/1.35 var(--font-body);margin-bottom:3mm;break-inside:avoid}
.letter-header.header{grid-template-columns:minmax(0,1fr) auto;column-gap:8mm;row-gap:3mm;padding-bottom:2mm;border-radius:0}
.motivation-letter .letter-header--single,.motivation-letter[data-contact-layout="below"] .letter-header{grid-template-columns:minmax(0,1fr)}
.motivation-letter[data-header-layout-style="separator"] .letter-header{border-bottom-width:.75pt}
.letter-header > .title{min-width:0}
.letter-header .name{font-size:var(--letter-header-name-size);line-height:1.2;font-weight:700}
.letter-header .role{font-size:10pt;line-height:1.35}
.letter-header :deep(.contact){min-width:0;max-width:75mm;gap:1mm;font-size:9pt;line-height:1.35;font-style:normal}
.letter-header :deep(.contact-icon){display:none}
.letter-header :deep(.contact>div),.letter-header :deep(.contact a){min-width:0;max-width:100%;overflow-wrap:anywhere}
.motivation-letter[data-contact-layout="below"] .letter-header :deep(.contact){flex-wrap:wrap;column-gap:4mm;white-space:normal;max-width:none}
.letter-header .letter-subject{grid-column:1/-1;font:700 var(--letter-body-size)/1.35 var(--font-head);text-transform:none;letter-spacing:0;margin:0;padding:0;border:0;border-radius:0;background:none;break-inside:avoid}
.letter-header .title ~ .letter-subject,.letter-header .contact ~ .letter-subject{margin-top:1mm}
.letter-section{display:flow-root;break-inside:avoid}
.letter-group{margin:0 0 2.5mm;break-inside:avoid}
.letter-paragraph{white-space:pre-wrap;margin:0 0 2.5mm;orphans:3;widows:3}
.letter-group > :last-child{margin-bottom:0}
.letter-section:last-child > .letter-group:last-child{margin-bottom:0}
.letter-group--closing{margin-top:4mm}
.letter-signature-line{width:48mm;max-width:100%;height:8mm;border-bottom:.5pt solid var(--ink);margin:0 0 2mm}
.letter-signature-name{white-space:pre-wrap;margin:0}
</style>
