<script setup lang="ts">
import { computed } from 'vue';
import type { CvDesign } from '../../../documents/cv/types';
import type { DesignControl, DesignControlRow, FavoriteLink, StringDesignKey } from '../domain/designControls';
import { DEFAULT_DESIGN, designValue, designNumber } from '../../../documents/cv/defaults';
import { makeT } from '../../../i18n/dict';
import InfoHint from '../../../shared/ui/InfoHint.vue';
const props = defineProps<{ modelValue: CvDesign; entries: DesignControlRow[]; lang: string }>();
const t = makeT(computed(() => props.lang));
const design = computed(() => new Proxy(props.modelValue, {
  get: (target, key) => key in DEFAULT_DESIGN ? designValue(target, key as keyof CvDesign) : Reflect.get(target, key),
}) as Required<CvDesign>);
function shortLabel(option: DesignControl) {
  return ({
    pageMarginTop: t('designTop'), pageMarginBottom: t('designBottom'),
    pageMarginRight: t('designRight'), pageMarginLeft: t('designLeft'),
    headerPaddingBottom: t('designPadding'), headerBottomMargin: t('designMargin'),
  } as Partial<Record<keyof CvDesign, string>>)[option.key] || option.label;
}
function controlValue(option: DesignControl) {
  const value = design.value[option.key];
  if (option.type !== 'range') return value;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : designNumber({}, option.key);
}
function valueLabel(option: DesignControl) {
  const value = controlValue(option);
  return option.type === 'range' ? `${value}${option.unit || option.suffix || ''}` : value;
}
function setControlValue(option: DesignControl, value: string | number | boolean) {
  if (option.type === 'toggle') {
    design.value[option.key] = Boolean(value);
    return;
  }
  if (option.type !== 'range') {
    design.value[option.key] = String(value);
    return;
  }

  if (option.unit !== undefined) {
    const nextValue = `${value}${option.unit}`;
    design.value[option.key] = nextValue;
    if (option.link && isLinked(option.link.linkKey)) {
      const pairedKey = option.link.primaryKey === option.key ? option.link.secondaryKey : option.link.primaryKey;
      design.value[pairedKey] = nextValue;
    }
  } else {
    design.value[option.key] = Number(value);
  }
}
function toggleLink(link: FavoriteLink) {
  const { linkKey, primaryKey, secondaryKey } = link;
  setLinked(linkKey, primaryKey, secondaryKey, !isLinked(linkKey));
}
function isLinked(key: FavoriteLink['linkKey']) {
  return designValue(design.value, key);
}

function setLinked(key: FavoriteLink['linkKey'], primaryKey: StringDesignKey, secondaryKey: StringDesignKey, linked: boolean) {
  design.value[key] = linked;
  if (linked) design.value[secondaryKey] = design.value[primaryKey];
}

</script>

<template>
          <div class="design-controls">
            <template v-for="entry in entries" :key="entry.type === 'linked' ? entry.key : entry.option.key">
              <div v-if="entry.type === 'linked'" class="design-control design-control--linked">
                <div class="design-paired-controls">
                  <div class="design-linked-slider">
                    <div class="design-linked-slider-heading">
                      <span>{{ isLinked(entry.link.linkKey) ? entry.label : shortLabel(entry.options[0]) }}: {{ valueLabel(entry.options[0]) }}</span>
                      <button class="mini link-toggle" type="button" :aria-label="t(isLinked(entry.link.linkKey) ? 'unlinkControls' : 'linkControls').replace('{label}', entry.label)" :aria-pressed="isLinked(entry.link.linkKey)" @click="toggleLink(entry.link)"><font-awesome-icon :icon="['fas', isLinked(entry.link.linkKey) ? 'link' : 'link-slash']" /></button>
                    </div>
                    <input type="range" :aria-label="isLinked(entry.link.linkKey) ? entry.label : entry.options[0].label" :aria-valuetext="String(valueLabel(entry.options[0]))" :min="entry.options[0].min" :max="entry.options[0].max" :step="entry.options[0].step" :value="controlValue(entry.options[0])" @input="setControlValue(entry.options[0], ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  </div>
                  <label v-if="!isLinked(entry.link.linkKey)">
                    <span>{{ shortLabel(entry.options[1]) }}: {{ valueLabel(entry.options[1]) }}</span>
                    <input type="range" :aria-label="entry.options[1].label" :aria-valuetext="String(valueLabel(entry.options[1]))" :min="entry.options[1].min" :max="entry.options[1].max" :step="entry.options[1].step" :value="controlValue(entry.options[1])" @input="setControlValue(entry.options[1], ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  </label>
                </div>
              </div>
              <div v-else class="design-control">
                <div v-if="entry.option.type !== 'toggle'" class="design-control-label"><span>{{ entry.option.label }}<template v-if="entry.option.type === 'range'">: {{ valueLabel(entry.option) }}</template></span><InfoHint v-if="entry.option.help" :lang="lang" :label="entry.option.label" :text="entry.option.help" /></div>
                <label v-if="entry.option.type === 'toggle'" class="design-toggle-control">
                  <span>{{ entry.option.label }}</span>
                  <input class="design-toggle" type="checkbox" role="switch" :checked="Boolean(controlValue(entry.option))" @change="setControlValue(entry.option, ($event.target as HTMLInputElement).checked)">
                </label>
                <input v-else-if="entry.option.type === 'range'" type="range" :aria-label="entry.option.label" :aria-valuetext="String(valueLabel(entry.option))" :min="entry.option.min" :max="entry.option.max" :step="entry.option.step" :value="String(controlValue(entry.option))" @input="setControlValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                <input v-else-if="entry.option.type === 'color'" type="color" :aria-label="entry.option.label" :value="String(controlValue(entry.option))" @input="setControlValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                <select v-else :aria-label="entry.option.label" :value="String(controlValue(entry.option))" @change="setControlValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  <option v-for="choice in entry.option.options" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                </select>
              </div>
            </template>
          </div>
</template>

<style scoped>
.design-controls { container: design-controls / inline-size; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 8px; min-width: 0; }
.design-control { display: grid; gap: 4px; align-content: start; min-width: 0; overflow-wrap: anywhere; }
.design-control--linked { grid-column: span 2; }
.design-control-label { display: flex; align-items: center; gap: 2px; color: var(--ui-muted); font-size: 10pt; }
.design-paired-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.design-linked-slider { display: grid; gap: 4px; min-width: 0; }
.design-linked-slider-heading { display: flex; align-items: center; gap: 6px; color: var(--ui-muted); font-size: 10pt; }
.design-paired-controls label { display: grid; gap: 4px; color: var(--ui-muted); font-size: 10pt; }
.link-toggle { flex: 0 0 auto; width: 28px; min-width: 28px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.link-toggle[aria-pressed="true"] { border-color: var(--ui-accent-border); background: var(--ui-active); color: var(--ui-accent); }
.design-toggle-control { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; color: var(--ui-muted); font-size: 10pt; cursor: pointer; }
.design-toggle { flex: 0 0 auto; width: 16px; height: 16px; margin: 0; accent-color: var(--ui-accent); cursor: pointer; }
.design-control input[type="range"] { accent-color: var(--ui-accent); }
@container design-controls (max-width: 367px) {
  .design-control--linked { grid-column: auto; }
  .design-paired-controls { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) { .design-controls, .design-paired-controls { grid-template-columns: 1fr; } .design-control--linked { grid-column: auto; } }
@media (max-width: 760px), (pointer: coarse) { .design-control input[type="range"], .design-control input[type="color"], .design-control select { min-height: 44px; } }
@media (max-width: 760px), (pointer: coarse) { .link-toggle { width: 44px; min-width: 44px; height: 44px; } }
</style>
