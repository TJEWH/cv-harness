<script setup lang="ts">
type View = 'outcomes' | 'topics' | 'alignment';
const props = defineProps<{ view: View; lang: string; panelId: string }>();
const emit = defineEmits<{ 'update:view': [value: View] }>();
const tabs = ['outcomes', 'topics', 'alignment'] as const;
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
function tabKey(event: KeyboardEvent, tab: View) {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + direction + tabs.length) % tabs.length;
  emit('update:view', tabs[index]!);
  (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus();
}
</script>

<template>
  <div class="timeline-tabs" role="tablist" :aria-label="text('Timeline view', 'Zeitachsenansicht')">
    <button v-for="tab in tabs" :id="`${panelId}-${tab}`" :key="tab" type="button" role="tab" :tabindex="view === tab ? 0 : -1" :aria-selected="view === tab" :aria-controls="panelId" @click="emit('update:view', tab)" @keydown="tabKey($event, tab)">{{ tab === 'outcomes' ? text('Outcomes', 'Ergebnisse') : tab === 'topics' ? text('Topics', 'Themen') : text('Alignment', 'Übereinstimmung') }}</button>
  </div>
</template>

<style scoped>
.timeline-tabs { display: flex; flex: 0 0 auto; gap: 4px; min-width: 0; border-bottom: 1px solid var(--ui-divider); }
.timeline-tabs button { flex: 0 1 auto; appearance: none; min-height: 38px; padding: 8px 14px; border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; color: var(--ui-muted); font: 600 12px/1.5 var(--font-ui); cursor: pointer; }
.timeline-tabs button[aria-selected=true] { color: var(--ui-accent); border-bottom-color: var(--ui-accent); }
.timeline-tabs button:hover { color: var(--ui-text); background: var(--ui-surface-hover); }
.timeline-tabs button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -3px; }
@media (max-width: 760px) { .timeline-tabs button { min-height: 44px; padding-inline: 12px; } }
</style>
