<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';

const props = defineProps<{ text: string; label: string; lang?: string; id?: string }>();
const generatedId = `info-hint-${useId()}`;
const trigger = ref<HTMLButtonElement | null>(null);
const tooltip = ref<HTMLElement | null>(null);
const open = ref(false);
const placement = ref<'top' | 'bottom'>('bottom');
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let pointerInside = false;
let focused = false;

function cancelClose() { clearTimeout(closeTimer); }
function position() {
  const button = trigger.value;
  const panel = tooltip.value;
  if (!button || !panel) return;
  const anchor = button.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0;
  const top = viewport?.offsetTop || 0;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const panelLeft = Math.max(left + 12, Math.min(anchor.left, left + width - bounds.width - 12));
  panel.style.left = `${panelLeft}px`;
  panel.style.setProperty('--info-hint-pointer-left', `${Math.max(12, Math.min(anchor.left + anchor.width / 2 - panelLeft, bounds.width - 12))}px`);
  const below = anchor.bottom + 6;
  const fitsBelow = below + bounds.height <= top + height - 12;
  placement.value = fitsBelow ? 'bottom' : 'top';
  panel.style.top = `${Math.max(top + 12, fitsBelow ? below : anchor.top - bounds.height - 6)}px`;
}
async function show() {
  cancelClose();
  if (open.value) return;
  open.value = true;
  await nextTick();
  if (!open.value) return;
  // The top layer keeps help visible inside scrolling panels and modal dialogs.
  tooltip.value?.showPopover?.();
  position();
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('resize', hide);
  window.addEventListener('scroll', onScroll, true);
}
function hide() {
  cancelClose();
  if (tooltip.value?.matches(':popover-open')) tooltip.value.hidePopover();
  open.value = false;
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('pointerdown', onOutside, true);
  window.removeEventListener('resize', hide);
  window.removeEventListener('scroll', onScroll, true);
}
function enter() { pointerInside = true; show(); }
function leave() { pointerInside = false; if (!focused) scheduleClose(); }
function focus() { focused = true; show(); }
function scheduleClose() { cancelClose(); closeTimer = setTimeout(hide, 140); }
function onOutside(event: PointerEvent) {
  if (!trigger.value?.contains(event.target as Node) && !tooltip.value?.contains(event.target as Node)) hide();
}
function onScroll(event: Event) {
  if (event.target !== window && tooltip.value?.contains(event.target as Node)) return;
  hide();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  hide();
}
function onBlur(event: FocusEvent) {
  focused = false;
  if (!pointerInside && !tooltip.value?.contains(event.relatedTarget as Node)) hide();
}
onBeforeUnmount(hide);
</script>

<template>
  <span class="info-hint">
    <button ref="trigger" class="info-hint__button" type="button" :aria-label="`${lang === 'de' ? 'Informationen' : 'Information'}: ${label}`" :aria-describedby="id || generatedId"
      @pointerenter="enter" @pointerleave="leave" @focus="focus" @blur="onBlur" @click.stop.prevent="show" @pointerdown.stop @keydown.enter.stop @keydown.space.stop>
      <FontAwesomeIcon :icon="faCircleInfo" aria-hidden="true" />
    </button>
    <span :id="id || generatedId" ref="tooltip" class="info-hint__tooltip" role="tooltip" popover="manual" :hidden="!open" :data-placement="placement"
      @pointerenter="enter" @pointerleave="leave"><span class="info-hint__content">{{ text }}</span></span>
  </span>
</template>

<style scoped>
.info-hint { display: inline-flex; vertical-align: middle; flex: 0 0 auto; margin-inline-start: 4px; }
.info-hint > .info-hint__button { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; width: 28px; height: 28px; min-width: 28px; min-height: 28px; margin: 0; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--ui-muted); font: inherit; cursor: help; box-shadow: none; }
.info-hint > .info-hint__button:hover { color: var(--ui-text); background: var(--ui-surface-hover); }
.info-hint > .info-hint__button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.info-hint__button > svg { width: 14px; height: 14px; margin: 0; color: inherit; }
.info-hint__tooltip { position: fixed; inset: auto; box-sizing: border-box; width: max-content; max-width: min(380px, calc(100vw - 24px)); max-height: none; overflow: visible; margin: 0; padding: 0; border: 0; border-radius: 8px; background: var(--ui-tooltip-bg); color: var(--ui-tooltip-text); box-shadow: 0 10px 30px #0008; font-family: var(--font-ui); font-size: 13px; font-weight: 500; line-height: 1.6; letter-spacing: normal; text-align: start; text-transform: none; white-space: normal; overflow-wrap: anywhere; z-index: 10000; }
.info-hint__tooltip::before { content: ''; position: absolute; top: -5px; left: calc(var(--info-hint-pointer-left, 14px) - 5px); width: 10px; height: 10px; background: inherit; transform: rotate(45deg); }
.info-hint__tooltip[data-placement="top"]::before { top: auto; bottom: -5px; }
.info-hint__content { display: block; box-sizing: border-box; max-height: calc(100dvh - 24px); overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px; border-radius: inherit; }
.info-hint__tooltip[hidden] { display: none; }
@media (pointer: coarse) { .info-hint > .info-hint__button { width: 36px; height: 36px; } }
</style>
