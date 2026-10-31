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
  const exploration = current.exploration_ratio === 0
    ? (props.lang === 'de' ? `Neue Suchrichtungen sind ausgeschaltet; höchstens ${current.maximum_queries} Abfragen pro Lauf.` : `Exploration is off; up to ${current.maximum_queries} queries per run.`)
    : (props.lang === 'de'
      ? `Reserviere ${percent} der freien Abfragen für neue Suchrichtungen, mindestens ${current.minimum_exploration_queries} bei freier Kapazität; insgesamt höchstens ${current.maximum_queries} Abfragen pro Lauf.`
      : `Reserve ${percent} of free queries for new directions, at least ${current.minimum_exploration_queries} when space allows; up to ${current.maximum_queries} queries per run.`);
  return props.lang === 'de'
    ? `Deine Bewertungen können Themen stärker gewichten, sobald mindestens ${current.minimum_observations} unterschiedliche Stellen im Mittel ${positiveThreshold}/10 erreichen; kleinere oder widersprüchliche Stichproben bleiben vorläufig. ${exploration}`
    : `Your ratings can raise topic priorities after at least ${current.minimum_observations} distinct reviewed opportunities average ${positiveThreshold}/10; smaller or conflicting samples remain provisional. ${exploration}`;
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
