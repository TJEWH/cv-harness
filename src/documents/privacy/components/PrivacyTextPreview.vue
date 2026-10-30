<script setup lang="ts">
import { privacySegments } from '../../../features/refinement/domain/refinementPrivacy';
defineProps<{ value: string; lang: string }>();
</script>

<template>
  <pre class="privacy-text"><span v-for="(part, index) in privacySegments(value)" :key="index" :data-privacy-status="part.status" :title="part.status === 'pseudonymized' ? (lang === 'de' ? 'Pseudonymisiert' : 'Pseudonymized') : (lang === 'de' ? 'Sichtbar' : 'Visible')">{{ part.text }}</span></pre>
</template>

<style scoped>
.privacy-text{max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6;background:#07121b;padding:10px;border-radius:6px;color:#d9e8e3}
[data-privacy-status=pseudonymized]{background:#35432d;color:#e5f5ac;border-radius:3px;font-weight:600}
</style>
