<script setup lang="ts">
import { computed } from 'vue';
import { makeT } from '../../../i18n/dict.ts';

const props = defineProps({
  name: { type: String, required: true },
  levelType: { type: String, default: '' }, // 'experience' or 'years' or empty
  levelValue: { type: Number, default: 0 },
  lang: { type: String, required: true }
});

const t = makeT(computed(() => props.lang));

// Prüfe ob Level-Anzeige aktiv ist
const hasLevel = computed(() => {
  return props.levelType && props.levelType !== '' && props.levelValue > 0;
});

// Berechne Anzahl voller und halber Kreise (max 5 Kreise für 1-10)
const circles = computed(() => {
  if (props.levelType !== 'experience' || !hasLevel.value) {
    return [];
  }

  // Erfahrung: 1-10, dargestellt in 5 Kreisen (2 Punkte pro Kreis)
  const totalCircles = 5;
  const value = Math.max(0, Math.min(10, props.levelValue)); // Clamp zwischen 0 und 10
  const fullCircles = Math.floor(value / 2);
  const hasHalfCircle = value % 2 === 1;

  const result = [];
  for (let i = 0; i < totalCircles; i++) {
    if (i < fullCircles) {
      result.push('full');
    } else if (i === fullCircles && hasHalfCircle) {
      result.push('half');
    } else {
      result.push('empty');
    }
  }
  return result;
});

const displayValue = computed(() => {
  if (props.levelType === 'years' && hasLevel.value) {
    const label = t(props.levelValue === 1 ? 'year' : 'years');
    return `${props.levelValue} ${label}`;
  }
  return ''; // Bei Erfahrung werden Kreise angezeigt
});
</script>

<template>
  <div class="skill-item">
    <span class="skill-name">{{ name }}</span>
    <div class="skill-level" v-if="hasLevel">
      <template v-if="levelType === 'years' && displayValue">
        <span class="years-display">{{ displayValue }}</span>
      </template>
      <template v-else-if="levelType === 'experience' && circles.length > 0">
        <div class="circles">
          <svg
            v-for="(circle, idx) in circles"
            :key="idx"
            class="circle"
            viewBox="0 0 20 20"
            width="12"
            height="12"
          >
            <!-- Leerer Kreis (Hintergrund) -->
            <circle
              cx="10"
              cy="10"
              r="8"
              stroke="var(--graphic)"
              stroke-width="1.5"
              fill="none"
              opacity="0.3"
            />
            <!-- Voller Kreis -->
            <circle
              v-if="circle === 'full'"
              cx="10"
              cy="10"
              r="8"
              fill="var(--graphic)"
            />
            <!-- Halber Kreis (linke Hälfte gefüllt) -->
            <path
              v-if="circle === 'half'"
              d="M 10,2 A 8,8 0 0,0 10,18 Z"
              fill="var(--graphic)"
            />
          </svg>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.skill-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  gap: 8px;
}

.skill-name {
  flex: 1;
  font-size: 9.5pt;
}

.skill-level {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.years-display {
  font-size: 8.5pt;
  opacity: 0.8;
  white-space: nowrap;
  font-weight: 700;
}

.circles {
  display: flex;
  gap: 2px;
  align-items: center;
}

.circle {
  display: block;
}
</style>
