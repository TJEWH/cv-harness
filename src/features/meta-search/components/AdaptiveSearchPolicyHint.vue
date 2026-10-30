<script setup lang="ts">
import { computed } from 'vue';
import { DEFAULT_ADAPTIVE_SEARCH_POLICY } from '../domain/adaptiveSearchPlanner';
import InfoHint from '../../../shared/ui/InfoHint.vue';

const props = defineProps<{ lang?: string; policy?: Readonly<{
  minimum_observations: number; exploration_ratio: number; maximum_queries: number; minimum_exploration_queries: number; positive_interest_threshold?: number; exploration_guidance?: string; institution_policy?: string;
}> }>();
const policy = computed(() => props.policy ?? DEFAULT_ADAPTIVE_SEARCH_POLICY);
const label = computed(() => props.lang === 'de' ? 'Adaptive Suchstrategie' : 'Adaptive search policy');
const help = computed(() => {
  const current = policy.value;
  const positiveThreshold = new Intl.NumberFormat(props.lang === 'de' ? 'de' : 'en').format(current.positive_interest_threshold ?? DEFAULT_ADAPTIVE_SEARCH_POLICY.positive_interest_threshold);
  const percent = new Intl.NumberFormat(props.lang === 'de' ? 'de' : 'en', { style: 'percent', maximumFractionDigits: 1 }).format(current.exploration_ratio);
  const heading = props.policy ? (props.lang === 'de' ? 'Aktuelle Strategie' : 'Current policy') : (props.lang === 'de' ? 'Konfigurierbare Anfangswerte' : 'Configurable initial defaults');
  const exploration = current.exploration_ratio === 0
    ? (props.lang === 'de' ? 'Die Erkundung neuer Suchrichtungen ist ausgeschaltet.' : 'Exploration is off.')
    : (props.lang === 'de'
      ? `Nach Kernabfragen werden ${percent} der frei verfügbaren Abfragen für neue Suchrichtungen reserviert, mindestens ${current.minimum_exploration_queries} bei ausreichender Kapazität.`
      : `After core queries, reserve ${percent} of discretionary queries for exploration, with at least ${current.minimum_exploration_queries} when capacity permits.`);
  const institutions = current.institution_policy === 'source-only-v1'
    ? (props.lang === 'de' ? ' Hochschulen dienen nur als wiederverwendbare Quellen. Jedes Projekt wird einzeln geprüft, ohne pauschalen Hochschulbonus.' : ' Institutions are reusable sources only. Screen each project independently, without a university-wide fit bonus.') : '';
  return props.lang === 'de'
    ? `${heading}: Automatische Prioritätsänderungen erfordern mindestens ${current.minimum_observations} unterschiedliche relevante Beobachtungen. Kleinere oder widersprüchliche Gruppen bleiben vorläufig. Ein mittleres Interesse ab ${positiveThreshold} gilt nach der anfänglichen Produktkonvention als positives Prioritätssignal. ${exploration} Insgesamt höchstens ${current.maximum_queries} Abfragen. Fällige Quellenprüfungen belegen keine Abfrageplätze. Ohne freie Kapazität gibt es keine Erkundungsabfrage. Jeder Lauf hält seine tatsächliche Aufteilung fest.${institutions}`
    : `${heading}: automatic priority changes require at least ${current.minimum_observations} distinct relevant observations. Smaller or contradictory groups remain provisional. A mean interest of at least ${positiveThreshold} is the initial positive-priority convention. ${exploration} Stay within the ${current.maximum_queries}-query limit. Due-source checks use no query slots. Without discretionary capacity there is no exploration allocation. Each run records its actual allocation.${institutions}`;
});
</script>

<template>
  <div class="adaptive-search-policy-hint hint-label-row">
    <span>{{ label }}</span><InfoHint :lang="lang" :label="label" :text="help" />
  </div>
</template>

<style scoped>
.adaptive-search-policy-hint { color: var(--ui-muted); font: 400 13px/1.6 var(--font-ui); }
</style>
