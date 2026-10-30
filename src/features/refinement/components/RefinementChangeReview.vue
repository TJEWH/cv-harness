<script setup lang="ts">
interface ReviewedCvChange {
  id: string; type: string; target: string; explanation: string; before: string; after: string;
  status: 'proposed' | 'accepted' | 'rejected';
}
defineProps<{
  changes: ReviewedCvChange[]; selected: string[]; comments: { id: string; target: string; explanation: string }[];
  lang: string; disabled: boolean; locked: boolean;
}>();
const emit = defineEmits<{ toggle: [id: string, included: boolean] }>();
const text = (lang: string, en: string, de: string) => lang === 'de' ? de : en;
</script>

<template>
  <section class="change-review" :aria-label="text(lang, 'CV change review', 'Prüfung der CV-Änderungen')">
    <p v-if="!changes.length" class="app-hint">{{ text(lang, 'No CV changes proposed.', 'Keine CV-Änderungen vorgeschlagen.') }}</p>
    <article v-for="change in changes" :key="change.id" class="change" :data-change-id="change.id">
      <label class="include"><input type="checkbox" :checked="selected.includes(change.id)" :disabled="disabled || locked" @change="emit('toggle', change.id, ($event.target as HTMLInputElement).checked)" /><span>{{ text(lang, 'Activate', 'Aktivieren') }} {{ change.id }} · {{ change.target }}</span></label>
      <div class="metadata"><code>{{ change.type }}</code><span class="badge" :class="selected.includes(change.id) ? 'badge--active' : ''">{{ selected.includes(change.id) ? text(lang, 'Active', 'Aktiv') : text(lang, 'Inactive', 'Inaktiv') }}</span></div>
      <p>{{ change.explanation }}</p>
      <div class="comparison" :aria-label="text(lang, 'Before and after comparison', 'Vorher-Nachher-Vergleich')">
        <div><strong>{{ text(lang, 'Before', 'Vorher') }}</strong><pre class="before">{{ change.before }}</pre></div>
        <div><strong>{{ text(lang, 'Proposed result', 'Vorgeschlagenes Ergebnis') }}</strong><pre class="after">{{ change.after || text(lang, '(Omitted from this application)', '(In dieser Bewerbung ausgelassen)') }}</pre></div>
      </div>
    </article>
    <article v-for="comment in comments" :key="comment.id" class="comment app-hint"><strong>{{ text(lang, 'Comment — manual review', 'Kommentar — manuell prüfen') }} · {{ comment.target }}</strong><p>{{ comment.explanation }}</p></article>
  </section>
</template>

<style scoped>
.change-review{font-size:13px;line-height:1.5;min-width:0}.change-review h4{font-size:15px;margin:16px 0 8px}.change-review p{color:#adc8c0;margin:9px 0}.change{padding:0 0 24px}.change+.change{padding-top:8px}.include{display:flex;align-items:flex-start;gap:9px;font-size:13px;font-weight:600;overflow-wrap:anywhere}.include input{flex:0 0 auto;width:18px;height:18px;margin:1px 0;accent-color:#67c8a6}.metadata{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0}.metadata code{color:#b8d9cf;font-size:12px}.badge{border:1px solid #47635e;padding:2px 8px;border-radius:20px;font-size:11px}.badge--active{color:#a7f3d0;background:#10382c}.comparison{display:grid;gap:8px;grid-template-columns:1fr 1fr;min-width:0}.comparison>div{min-width:0}.comparison strong{font-size:11px;color:#b3cbc3}.comparison pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;padding:10px;border-radius:5px;margin:6px 0}.before{background:#291d22;color:#f8cdcd}.after{background:#103029;color:#b9efd8}.comment{border-top:1px solid #28534e;margin:0;padding:14px 0}.change-review :focus-visible{outline:2px solid #86efac;outline-offset:3px}@media(max-width:760px){.comparison{grid-template-columns:1fr}.change-review,.include{font-size:14px}}
</style>
