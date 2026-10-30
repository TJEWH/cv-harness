<script setup lang="ts">
withDefaults(defineProps<{ lang?: string }>(), { lang: 'en' });
</script>

<template>
  <aside class="desktop-sidebar" :aria-label="lang === 'de' ? 'Navigation und Aktionen' : 'Navigation and actions'">
    <div class="desktop-sidebar__header"><slot name="header" /></div>
    <div id="desktop-sidebar-subtabs" class="desktop-sidebar__subtabs" />
    <div class="desktop-sidebar__actions">
      <div id="desktop-sidebar-major" class="desktop-sidebar__major" />
      <div id="desktop-sidebar-minor" class="desktop-sidebar__minor" />
    </div>
  </aside>
</template>

<style>
.desktop-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; border-right: 1px solid var(--ui-divider); background: var(--ui-shell); color: var(--ui-text); }
.desktop-sidebar__header { height: var(--topbar-tab-height, 66px); flex: 0 0 var(--topbar-tab-height, 66px); min-width: 0; position: relative; z-index: 40; }
.desktop-sidebar__header > * { width: 100%; height: 100%; }
.desktop-sidebar__header .supabase-auth:not(.supabase-auth--bottom) summary { width: 100%; height: var(--topbar-tab-height, 66px); border-radius: 0; border-width: 0 0 1px; }
.desktop-sidebar__header .supabase-auth__panel { left: 12px; right: auto; width: min(340px, calc(100vw - 24px)); }
.desktop-sidebar__subtabs { display: flex; flex-direction: column; flex: 0 0 auto; max-height: 48%; overflow-y: auto; scrollbar-width: thin; gap: 0px; padding: 5px; border-bottom: 1px solid var(--ui-divider); }
.desktop-sidebar__subtabs:empty { display: none; }
.desktop-sidebar__subtabs > nav { display: flex; flex-direction: column; gap: 6px; margin: 0; width: 100%; }
.desktop-sidebar__subtabs button, .desktop-sidebar__subtabs .btn { width: 100%; justify-content: flex-start; text-align: left; min-height: 38px; white-space: normal; background: none; border-radius: 0; border: none; }
.desktop-sidebar__subtabs button:hover, .desktop-sidebar__subtabs .btn:hover { background: var(--ui-surface-hover); }
.desktop-sidebar__subtabs button[aria-pressed="true"] { position: relative; background: var(--ui-active); color: var(--ui-accent); }
.desktop-sidebar__subtabs button[aria-pressed="true"]::before { content: ''; position: absolute; inset: 8px auto 8px 0; width: 1px; background: var(--ui-accent); }
.desktop-sidebar__subtabs button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
.desktop-sidebar__subtabs .svg-inline--fa { width: 16px; flex: 0 0 16px; }
.desktop-sidebar__actions { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; overflow-y: auto; padding: 16px 14px; gap: 24px; scrollbar-width: thin; }
.desktop-sidebar__major, .desktop-sidebar__minor { display: flex; flex-direction: column; gap: 12px; min-width: 0; flex-shrink: 0; }
.desktop-sidebar__minor { margin-top: auto; }
.desktop-sidebar__major:empty, .desktop-sidebar__minor:empty { display: none; }
.desktop-sidebar__major > *, .desktop-sidebar__minor > * { min-width: 0; max-width: 100%; }
.desktop-sidebar__major label, .desktop-sidebar__minor label { min-width: 0; }
.desktop-sidebar select, .desktop-sidebar input:not([type="checkbox"]):not([type="radio"]), .desktop-sidebar textarea { width: 100%; min-width: 0; }
.desktop-sidebar button { overflow-wrap: anywhere; }
.desktop-sidebar__actions .action-row { flex-direction: column; align-items: stretch; gap: 8px; }
.desktop-sidebar__actions .action-row > button { width: 100%; }
.desktop-sidebar__actions .refinement-approval { margin-left: 0; }
.desktop-sidebar__actions .refinement-approval > button { width: 100%; }
@media (min-width: 761px) and (max-width: 1180px) { .desktop-sidebar__actions, .desktop-sidebar__subtabs { padding-left: 10px; padding-right: 10px; } }
@media (max-width: 760px) { .desktop-sidebar { display: none; } }
</style>
