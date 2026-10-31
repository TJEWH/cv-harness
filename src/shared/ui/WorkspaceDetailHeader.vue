<script setup lang="ts">
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import { useDesktopSidebar } from './desktopSidebar';
defineProps<{ title: string; subtitle?: string; backLabel: string; status?: string; sidebarActive?: boolean }>();
const desktopSidebar = useDesktopSidebar();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <header class="workspace-detail-header workspace-page-heading">
    <div class="workspace-detail-header__main">
      <div class="workspace-detail-header__controls">
        <DesktopSidebarPortal area="subtabs" :active="sidebarActive === true">
          <button class="btn workspace-detail-header__back" :class="{ 'workspace-detail-header__back--sidebar': sidebarActive && desktopSidebar }" type="button" :aria-label="backLabel" @click="emit('back')"><svg class="workspace-detail-header__back-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 4-6 6 6 6M2 10h16" /></svg><span class="workspace-detail-header__back-label">{{ backLabel }}</span></button>
        </DesktopSidebarPortal>
        <DesktopSidebarPortal area="major" :active="sidebarActive === true">
          <div v-if="$slots.actions" class="workspace-detail-header__actions" :class="{ 'workspace-detail-header__actions--sidebar': sidebarActive && desktopSidebar }"><slot name="actions" /></div>
        </DesktopSidebarPortal>
      </div>
      <div class="workspace-detail-header__title"><h1>{{ title }}</h1><p v-if="subtitle">{{ subtitle }}</p></div>
      <span v-if="status" class="workspace-detail-header__status">{{ status }}</span>
    </div>
    <div v-if="$slots.metadata" class="workspace-detail-header__metadata"><slot name="metadata" /></div>
    <div v-if="$slots['secondary-actions']" class="workspace-detail-header__secondary-actions"><slot name="secondary-actions" /></div>
  </header>
</template>

<style scoped>
.workspace-detail-header { flex: 0 0 auto; min-width: 0; margin: 0; padding-bottom: 10px; border-bottom: 1px solid var(--ui-divider); color: var(--ui-text);}
.workspace-detail-header__main { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; min-width: 0; }
.workspace-detail-header__controls { display: contents; }
.workspace-detail-header__back { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; order: 0; }
.workspace-detail-header__back-icon { width: 16px; height: 16px; flex-shrink: 0; }
.workspace-detail-header__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; margin-left: auto; order: 3; }
.workspace-detail-header__actions--sidebar { display: grid; width: 100%; margin: 0; gap: 16px; }
.workspace-detail-header__actions--sidebar :deep(> *) { width: 100%; }
.workspace-detail-header__back--sidebar { justify-content: flex-start; width: 100%; }
.workspace-detail-header__title { flex: 1 1 240px; min-width: 0; order: 1; }
.workspace-detail-header__title h1 { margin: 0; font-size: 24px; line-height: 1.25; overflow-wrap: anywhere; }
.workspace-detail-header__title p { margin: 5px 0 0; color: var(--ui-muted); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.workspace-detail-header__status { order: 2; max-width: 100%; padding: 5px 9px; border: 1px solid var(--ui-accent-border); border-radius: 6px; color: var(--ui-accent); font-size: 12px; overflow-wrap: anywhere; }
.workspace-detail-header__metadata { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; min-width: 0; margin-top: 14px; color: var(--ui-muted); font-size: 12px; line-height: 1.5; font-variant-numeric: tabular-nums; }
.workspace-detail-header__secondary-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; margin-top: 6px; }
@media (min-width: 761px) and (max-height: 600px) {
  .workspace-detail-header__title h1 { font-size: 18px; }
  .workspace-detail-header__metadata { margin-top: 6px; }
}
@media (max-width: 760px) {
  .workspace-detail-header { padding: 10px 12px; border-bottom: 1px solid var(--ui-divider); background: var(--ui-shell); }
  .workspace-detail-header__main { gap: 4px 8px; }
  .workspace-detail-header__controls { position: fixed; inset-inline: 0; bottom: calc(var(--mobile-tabs-height, 76px) + var(--mobile-application-tabs-height, 0px)); z-index: 35; display: flex; align-items: center; gap: 8px; box-sizing: border-box; height: var(--mobile-context-row-height, 52px); padding: 3px max(8px, env(safe-area-inset-right, 0px)) 3px max(8px, env(safe-area-inset-left, 0px)); border-top: 1px solid var(--ui-border); background: var(--ui-shell); }
  .workspace-detail-header__back { justify-content: center; width: 44px; min-height: 44px; padding: 0; font-size: 22px; }
  .workspace-detail-header__back-icon { width: 20px; height: 20px; }
  .workspace-detail-header__back-label { display: none; }
  .workspace-detail-header__actions { flex: 1; flex-wrap: nowrap; justify-content: flex-end; gap: 6px; }
  .workspace-detail-header__actions :deep(> *) { min-width: 0; }
  .workspace-detail-header__actions :deep(button), .workspace-detail-header__actions :deep(select) { min-height: 40px; }
  .workspace-detail-header__title { flex-basis: 100%; }
  .workspace-detail-header__title h1 { font-size: 17px; line-height: 1.25; }
  .workspace-detail-header__title p { margin-top: 3px; font-size: 13px; line-height: 1.35; }
  .workspace-detail-header__status { display: none; }
  .workspace-detail-header__metadata { gap: 4px 10px; margin-top: 6px; font-size: 12px; line-height: 1.35; }
  .workspace-detail-header__secondary-actions { margin-top: 2px; }
}
</style>
