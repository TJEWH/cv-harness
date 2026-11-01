<script setup lang="ts">
type View = 'outcomes' | 'topics' | 'alignment';
const props = withDefaults(defineProps<{ view: View; lang: string; panelId: string; sidebar?: boolean }>(), { sidebar: false });
const emit = defineEmits<{ 'update:view': [value: View] }>();
const tabs = ['outcomes', 'topics', 'alignment'] as const;
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
function tabKey(event: KeyboardEvent, tab: View) {
  const previousKey = props.sidebar ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = props.sidebar ? 'ArrowDown' : 'ArrowRight';
  const direction = event.key === previousKey ? -1 : event.key === nextKey ? 1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + direction + tabs.length) % tabs.length;
  emit('update:view', tabs[index]!);
  (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus();
}
</script>

<template>
  <div class="timeline-tabs workspace-subtabs" :class="{ 'is-sidebar': sidebar }" role="tablist" :aria-orientation="sidebar ? 'vertical' : 'horizontal'" :aria-label="text('Timeline view', 'Zeitachsenansicht')">
    <button v-for="tab in tabs" :id="`${panelId}-${tab}`" :key="tab" type="button" class="btn" :class="{ 'is-active': view === tab }" role="tab" :tabindex="view === tab ? 0 : -1" :aria-selected="view === tab" :aria-controls="panelId" @click="emit('update:view', tab)" @keydown="tabKey($event, tab)">{{ tab === 'outcomes' ? text('Outcomes', 'Ergebnisse') : tab === 'topics' ? text('Topics', 'Themen') : text('Alignment', 'Übereinstimmung') }}</button>
  </div>
</template>

<style scoped>
.timeline-tabs { display: flex; flex: 0 0 auto; flex-wrap: nowrap; gap: 6px; min-width: 0; margin: 0; padding-block: 8px; border-bottom: 1px solid var(--ui-divider); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; }
.timeline-tabs .btn { flex: 0 0 auto; min-height: 38px; font: 600 12px/1.5 var(--font-ui); white-space: nowrap; }
.timeline-tabs .btn:not(.is-active) { color: var(--ui-muted); }
.timeline-tabs .btn:not(.is-active):hover { color: var(--ui-text); }
.timeline-tabs .btn.is-active, .timeline-tabs .btn.is-active:hover { border-color: var(--ui-accent-border); color: var(--ui-accent); background: var(--ui-active); }
.timeline-tabs .btn:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.timeline-tabs.is-sidebar { flex-direction: column; gap: 6px; padding: 0; border: 0; overflow: visible; }
.timeline-tabs.is-sidebar .btn { width: 100%; justify-content: flex-start; text-align: left; white-space: normal; }
@media (max-width: 760px) {
  .timeline-tabs { gap: 0; height: 44px; padding-block: 0; scrollbar-width: none; }
  .timeline-tabs .btn { flex: 1 0 auto; min-height: 44px; }
  .timeline-tabs .btn.is-active, .timeline-tabs .btn.is-active:hover { border-bottom-color: var(--ui-accent); color: var(--ui-text); }
}
</style>
