<script setup lang="ts">
import InfoHint from '../../../shared/ui/InfoHint.vue';
import { computed } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faRulerCombined } from '@fortawesome/free-solid-svg-icons';
import type { LetterFormatting } from '../letterTypes';
import { DEFAULT_LETTER_FORMATTING, LETTER_FORMATTING_LIMITS, resolveLetterFormatting } from '../domain/letterFormatting';

const props = defineProps<{ formatting?: LetterFormatting; baseFormatting?: LetterFormatting; lang: string; disabled?: boolean; templateMode?: boolean }>();
const emit = defineEmits<{ change: [formatting: LetterFormatting | undefined] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const current = computed(() => resolveLetterFormatting(props.formatting, props.baseFormatting));
const defaults = computed(() => resolveLetterFormatting(props.baseFormatting));
const custom = computed(() => Object.keys(DEFAULT_LETTER_FORMATTING).some(key => current.value[key as keyof LetterFormatting] !== defaults.value[key as keyof LetterFormatting]));
const displayNumber = (value: number) => new Intl.NumberFormat(props.lang === 'de' ? 'de' : 'en').format(value);
function update(key: keyof LetterFormatting, event: Event) {
  if (props.disabled) return;
  const input = event.target as HTMLInputElement;
  if (!input.checkValidity()) { input.reportValidity(); return; }
  emit('change', { ...current.value, [key]: input.valueAsNumber });
}
</script>

<template>
  <component :is="templateMode ? 'section' : 'details'" class="letter-formatting" :class="{ 'disclosure-row': !templateMode, 'letter-formatting--template': templateMode }">
    <component :is="templateMode ? 'h3' : 'summary'" class="formatting-heading"><FontAwesomeIcon :icon="faRulerCombined" aria-hidden="true" />{{ templateMode ? text('Base letter formatting', 'Grundformatierung des Briefs') : text('Letter formatting', 'Briefformatierung') }}<span v-if="!templateMode" class="formatting-values">{{ current.marginMm }} mm · {{ displayNumber(current.fontSizePt) }} pt · {{ displayNumber(current.lineHeight) }}</span><InfoHint :lang="lang" :label="text('Letter formatting', 'Briefformatierung')" :text="templateMode ? text('New application letters use these settings. You can adjust each application’s letter in the manual editor.', 'Neue Bewerbungsbriefe verwenden diese Einstellungen. Im manuellen Editor können Sie die Formatierung je Bewerbung anpassen.') : baseFormatting ? text('Starts from the selected template’s formatting. Adjust this letter to match the institution’s requirements.', 'Ausgangspunkt ist die Formatierung der gewählten Vorlage. Passen Sie diesen Brief an die Vorgaben der Einrichtung an.') : text('General PhD letter defaults. Adjust this letter if a university provides specific formatting requirements.', 'Allgemeine Grundeinstellungen für Promotionsbewerbungen. Bei konkreten Formatvorgaben einer Hochschule diesen Brief hier anpassen.')" /></component>
    <fieldset :disabled="disabled">
      <legend class="sr-only">{{ text('Letter formatting', 'Briefformatierung') }}</legend>
      <div class="formatting-fields">
        <label>{{ text('Page margins (mm)', 'Seitenränder (mm)') }}<input type="number" required :value="current.marginMm" v-bind="LETTER_FORMATTING_LIMITS.marginMm" @change="update('marginMm', $event)" /></label>
        <label>{{ text('Body size (pt)', 'Textgröße (pt)') }}<input type="number" required :value="current.fontSizePt" v-bind="LETTER_FORMATTING_LIMITS.fontSizePt" @change="update('fontSizePt', $event)" /></label>
        <label>{{ text('Header name size (pt)', 'Namensgröße im Briefkopf (pt)') }}<input type="number" required :value="current.headerNameSizePt" v-bind="LETTER_FORMATTING_LIMITS.headerNameSizePt" @change="update('headerNameSizePt', $event)" /></label>
        <label>{{ text('Line spacing', 'Zeilenabstand') }}<input type="number" required :value="current.lineHeight" v-bind="LETTER_FORMATTING_LIMITS.lineHeight" @change="update('lineHeight', $event)" /></label>
      </div>
      <button type="button" :disabled="!custom" @click="emit('change', undefined)">{{ baseFormatting ? text('Reset to template defaults', 'Vorlageneinstellungen wiederherstellen') : text('Reset to default', 'Auf Standard zurücksetzen') }}</button>
    </fieldset>
  </component>
</template>

<style scoped>
.letter-formatting{margin-top:20px}
.letter-formatting--template{margin-top:0;padding-top:18px;border-top:1px solid var(--ui-divider)}
.formatting-heading{margin:0;font-size:13px;font-weight:600;line-height:1.5}
.formatting-heading svg{width:14px;margin-right:8px;color:var(--ui-accent)}
.formatting-values{margin-left:12px;color:var(--ui-muted);font-size:12px;font-weight:400;font-variant-numeric:tabular-nums;white-space:nowrap}
summary{cursor:pointer}
fieldset{min-width:0;margin:12px 0 0;padding:0;border:0}
.formatting-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
label{display:grid;gap:7px;align-content:start;margin-bottom:12px;font-size:12px;font-weight:600;line-height:1.5}
input,button{box-sizing:border-box;font:inherit;color:var(--ui-text);background:var(--ui-control);border:1px solid var(--ui-border);border-radius:7px;padding:9px 11px}
input{width:100%;min-width:0;font-size:14px;font-weight:400;font-variant-numeric:tabular-nums;caret-color:var(--ui-accent)}
button{cursor:pointer;font-size:13px;line-height:1.5;text-align:left}
button:hover:enabled{background:var(--ui-surface-hover)}
button:disabled,fieldset:disabled input{opacity:.45;cursor:not-allowed}
input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--ui-accent);outline-offset:3px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
@media(max-width:760px){input{font-size:16px}.formatting-fields{gap:10px}.formatting-values{display:block;margin:4px 0 0}}
@media(max-width:390px){.formatting-fields{grid-template-columns:minmax(0,1fr)}}
</style>
