<script setup lang="ts">
import { computed, ref } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faCalendarPlus } from '@fortawesome/free-solid-svg-icons';
import type { Application } from '../../../app/cloudTypes';
import { buildApplicationDeadlineCalendar } from '../domain/applicationDeadlineCalendar';
import { resolveDeadline } from '../../opportunities/domain/opportunityDeadline';
import { useToastWatch } from '../../../shared/ui/useToasts';

const props = defineProps<{ application: Pick<Application, 'id' | 'application_code' | 'context_json'>; lang: string }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const available = computed(() => !!resolveDeadline(props.application.context_json, '23:59'));
const label = computed(() => available.value
  ? text('Download deadline calendar (.ics), with a reminder one week before', 'Bewerbungsfrist als Kalenderdatei (.ics) herunterladen, mit Erinnerung eine Woche vorher')
  : text('Calendar download unavailable: no confirmed deadline', 'Kalenderdownload nicht verfügbar: keine bestätigte Frist'));
const error = ref('');
useToastWatch(() => error.value, { tone: 'error' });

function download() {
  error.value = '';
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    const calendar = buildApplicationDeadlineCalendar(props.application, props.lang);
    if (!calendar) return;
    url = URL.createObjectURL(new Blob([calendar.content], { type: 'text/calendar;charset=utf-8' }));
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = calendar.filename;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } catch {
    error.value = text('Could not download the calendar file. Please try again.', 'Die Kalenderdatei konnte nicht heruntergeladen werden. Bitte erneut versuchen.');
  } finally {
    anchor?.remove();
    if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 1000);
  }
}
</script>

<template>
  <button class="application-deadline-calendar" type="button" :disabled="!available" :title="label" :aria-label="label" @click.stop="download">
    <FontAwesomeIcon :icon="faCalendarPlus" aria-hidden="true" />
    <span>{{ text('Calendar (.ics)', 'Kalender (.ics)') }}</span>
  </button>
</template>

<style scoped>
.application-deadline-calendar{display:inline-flex;align-items:center;justify-content:center;gap:7px;flex-shrink:0;min-height:32px;padding:5px 9px;border:1px solid #356454;border-radius:6px;background:#0b1b25;color:#d1fae5;font:inherit;font-size:12px;line-height:1.4;cursor:pointer}
.application-deadline-calendar:hover:not(:disabled){background:#153a35;border-color:#67c8a6}
.application-deadline-calendar:focus-visible{outline:2px solid #67c8a6;outline-offset:2px}
.application-deadline-calendar:disabled{opacity:.5;cursor:default}
@media(max-width:760px){.application-deadline-calendar{min-height:40px;padding:7px 10px;font-size:13px}}
</style>
