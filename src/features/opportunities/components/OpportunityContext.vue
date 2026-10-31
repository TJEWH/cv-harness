<script setup lang="ts">
import { computed, defineComponent, h, useId } from 'vue';
import type { PropType, VNode } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faCalculator, faChartSimple, faCoins, faDatabase, faFileLines, faFlask, faLink, faListCheck, faUsers } from '@fortawesome/free-solid-svg-icons';
import { buildOpportunityGroups, checklistKeys, fitScoreTone, requirementTableRows } from '../domain/opportunityContext';
import type { OpportunityContextNode, OpportunityContextGroupId } from '../domain/opportunityContext';

const props = defineProps<{ context: Record<string, unknown>; lang: string; checklist?: boolean; completedKeys?: string[]; saving?: boolean; defaultOpenGroups?: string[]; onlyGroups?: OpportunityContextGroupId[] }>();
const emit = defineEmits<{ toggleChecklist: [key: string, completed: boolean] }>();
const groups = computed(() => buildOpportunityGroups(props.context, props.lang).filter(group => !props.onlyGroups || props.onlyGroups.includes(group.id)));
const completed = computed(() => new Set(props.completedKeys || []));
const groupIcons = { overview: faFlask, requirements: faListCheck, documents: faFileLines, salary: faCoins, advisor: faUsers, links: faLink, metadata: faDatabase };
const disclosureIcon = (icon: typeof faLink) => h(FontAwesomeIcon, { icon, class: 'disclosure-prefix', 'aria-hidden': 'true' });
function progress(nodes: OpportunityContextNode[]) {
  const keys = checklistKeys(nodes);
  return keys.length ? `${keys.filter((key) => completed.value.has(key)).length} / ${keys.length} ${props.lang === 'de' ? 'erledigt' : 'done'}` : '';
}
function requirementStatusLabel(status: OpportunityContextNode['requirementStatus']) {
  const labels = {
    required: ['Required', 'Erforderlich'], optional: ['Optional', 'Optional'], beneficial: ['Beneficial', 'Von Vorteil'],
    conditional: ['Conditional', 'Bedingt erforderlich'],
    unspecified: ['Not specified', 'Nicht angegeben'],
    preferred: ['Preferred', 'Bevorzugt'], recommended: ['Recommended', 'Empfohlen'], desired: ['Desired', 'Gewünscht'],
  };
  return status ? labels[status][props.lang === 'de' ? 1 : 0] : props.lang === 'de' ? 'Nicht angegeben' : 'Not specified';
}

function toggleScoreSummaries(event: MouseEvent) {
  if (!window.matchMedia('(min-width: 761px)').matches) return;
  const summary = event.currentTarget as HTMLElement;
  const selected = summary.parentElement as HTMLDetailsElement;
  const context = summary.closest('.opportunity-context');
  if (!context) return;
  event.preventDefault();
  const open = !selected.open;
  // Only synchronize this opportunity's scores; mobile retains native independent toggles.
  for (const detail of context.querySelectorAll<HTMLDetailsElement>('.opportunity-context__score-details')) detail.open = open;
}

// Vue escapes every supplied text node, including requirement table cells.
const SourceLinks = defineComponent({
  name: 'OpportunitySourceLinks',
  props: { node: { type: Object as PropType<OpportunityContextNode>, required: true } },
  setup(sourceProps) {
    return () => {
      const sources = [...new Map((sourceProps.node.evidence ?? []).map(source => [source.href, source])).values()];
      return sources.length ? h('span', { class: 'opportunity-context__source-links' }, sources.map(source => {
        const label = `${sourceProps.node.label ? `${sourceProps.node.label}: ` : ''}${props.lang === 'de' ? 'Quelle öffnen' : 'Open source'} (${source.text})`;
        return h('a', { key: source.href, class: 'opportunity-context__source-link', href: source.href,
          target: '_blank', rel: 'noopener noreferrer', 'aria-label': label, title: `${label}\n${source.href}` },
        [h(FontAwesomeIcon, { icon: faLink, 'aria-hidden': 'true' })]);
      })) : null;
    };
  },
});

const ContextValue = defineComponent({
  name: 'OpportunityContextValue',
  props: { node: { type: Object as PropType<OpportunityContextNode>, required: true }, table: Boolean },
  setup(valueProps) {
    const inputPrefix = useId();
    const checklistInputId = (node: OpportunityContextNode) => `${inputPrefix}-checklist-${encodeURIComponent(node.id)}`;
    function renderEvidence(node: OpportunityContextNode): VNode | null {
      return node.evidence?.length ? h(SourceLinks, { node }) : null;
    }
    function renderValue(node: OpportunityContextNode, withCheckbox = true, labelFor?: string, includeLabel = false, scoreProse = false): VNode {
      if (props.checklist && withCheckbox && node.checklistKey) {
        const key = node.checklistKey;
        const checked = completed.value.has(key);
        const inputId = checklistInputId(node);
        const checkboxLabel = includeLabel && node.label ? node.label : node.href && !node.children?.length
          ? props.lang === 'de' ? 'Als erledigt markieren' : 'Mark complete' : null;
        return h('div', { class: ['opportunity-context__checklist-item', { 'is-complete': checked }] }, [
          h('input', { id: inputId, type: 'checkbox', checked, disabled: props.saving,
            'aria-label': [node.label, node.text].filter(Boolean).join(': ') || node.children?.map((child) => child.text || child.label).filter(Boolean).join('; '),
            onChange: (event: Event) => {
              const target = event.target as HTMLInputElement;
              const next = target.checked;
              target.checked = checked;
              emit('toggleChecklist', key, next);
            } }),
          h('div', [checkboxLabel ? h('label', { for: inputId, class: 'opportunity-context__checklist-label opportunity-context__nested-label' }, `${checkboxLabel}${node.text || node.children?.length ? ': ' : ''}`) : null, renderValue(node, false, inputId)]),
        ]);
      }
      if (includeLabel && node.label) {
        return h('div', [h('span', { class: 'opportunity-context__nested-label' }, `${node.label}${node.text || node.children?.length ? ': ' : ''}`), renderValue(node, false, labelFor)]);
      }
      const value = node.href ? h('a', { href: node.href, ...(node.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, node.text)
        : h(labelFor ? 'label' : 'span', { ...(labelFor ? { for: labelFor } : {}), class: { 'opportunity-context__checklist-label': !!labelFor, 'opportunity-context__missing': node.missing } }, node.text);
      const withinScore = scoreProse || node.kind === 'fit';
      const singleScorePoint = withinScore && node.children?.length === 1;
      const plainChildren = valueProps.table || singleScorePoint;
      const displayedChildren = node.kind === 'living-standard' ? node.children?.filter(child => !child.id.endsWith('.salary_verdict')) : node.children;
      const children = displayedChildren?.length ? h(plainChildren ? 'div' : 'ul', { class: valueProps.table ? 'opportunity-context__values' : singleScorePoint ? 'opportunity-context__prose' : 'opportunity-context__list' }, displayedChildren.map((child) => {
        const checklistChild = !!(props.checklist && !labelFor && child.checklistKey);
        return h(plainChildren ? 'div' : 'li', { key: child.id }, [child.label && !checklistChild ? h(labelFor ? 'label' : 'span', { ...(labelFor ? { for: labelFor } : {}), class: ['opportunity-context__nested-label', { 'opportunity-context__checklist-label': !!labelFor }] }, `${child.label}: `) : null, renderValue(child, !labelFor, labelFor, checklistChild, withinScore)]);
      })) : null;
      if (node.kind === 'fit') {
        const score = node.score;
        const explanation = [score === undefined && node.text ? value : null, children].filter(Boolean) as VNode[];
        const expandable = explanation.length > 0;
        const scoreContent = score !== undefined ? [
          h('strong', { class: 'opportunity-context__score-number' }, [expandable ? disclosureIcon(faChartSimple) : null, node.text]),
          h('span', { class: 'opportunity-context__score-track', role: 'meter', 'aria-label': node.label,
            'aria-valuemin': 0, 'aria-valuemax': 10, 'aria-valuenow': score, 'aria-valuetext': node.text },
          h('span', { class: 'opportunity-context__score-fill', style: { width: `${score * 10}%` }, 'aria-hidden': 'true' })),
        ] : [h('span', { class: 'opportunity-context__missing' }, [expandable ? disclosureIcon(faChartSimple) : null, props.lang === 'de' ? 'Keine Bewertung auf der Skala 0–10' : 'No score on the 0–10 scale'])];
        const heading = h(expandable ? 'summary' : 'div', {
          class: ['opportunity-context__score', fitScoreTone(score) && `opportunity-context__score--${fitScoreTone(score)}`],
          ...(expandable ? { 'aria-label': [node.label, score !== undefined ? node.text : null].filter(Boolean).join(': '), onClick: toggleScoreSummaries } : {}),
        }, scoreContent);
        const scoreView = expandable
          ? h('details', { class: 'opportunity-context__score-details' }, [heading, ...explanation])
          : h('div', [heading]);
        return node.evidence?.length ? h('div', [scoreView, renderEvidence(node)]) : scoreView;
      }
      if (!children) return node.evidence?.length ? h('span', [value, renderEvidence(node)]) : value;
      if (node.kind === 'living-standard') return h('div', { class: 'opportunity-context__living-standard' }, [
        h('strong', { class: 'opportunity-context__living-standard-score' }, node.text),
        renderEvidence(node),
        h('p', { class: 'opportunity-context__prose' }, [
          `${props.lang === 'de' ? 'Gehaltsbewertung' : 'Salary verdict'}: `,
          node.children?.find(child => child.id.endsWith('.salary_verdict'))?.text,
        ]),
        h('details', [h('summary', [disclosureIcon(faCalculator), props.lang === 'de' ? 'Bewertung und Annahmen' : 'Breakdown and assumptions']), children]),
      ]);
      return h('div', [node.text ? value : null, children, renderEvidence(node)]);
    }
    return () => {
      if (!valueProps.table) return renderValue(valueProps.node);
      const rows = requirementTableRows(valueProps.node);
      const canonical = rows.some(row => row.kind === 'requirement' || row.kind === 'prose');
      const stageLabel = (row: OpportunityContextNode) => row.requirementStage || (props.lang === 'de' ? 'Nicht angegeben' : 'Not specified');
      const showStage = new Set(rows.filter(row => row.kind === 'requirement').map(stageLabel)).size > 1;
      if (canonical) return h('table', { class: `opportunity-context__requirements-table opportunity-context__requirements-table--canonical${showStage ? ' opportunity-context__requirements-table--stages' : ''}`, 'aria-label': valueProps.node.label, role: 'table', lang: props.lang }, [
        h('thead', { role: 'rowgroup' }, [h('tr', { role: 'row' }, [
          h('th', { id: `${inputPrefix}-item`, scope: 'col', role: 'columnheader' }, props.lang === 'de' ? 'Eintrag' : 'Item'),
          h('th', { id: `${inputPrefix}-status`, scope: 'col', role: 'columnheader', class: 'opportunity-context__requirement-status' }, 'Status'),
          showStage ? h('th', { id: `${inputPrefix}-stage`, scope: 'col', role: 'columnheader', class: 'opportunity-context__requirement-stage' }, props.lang === 'de' ? 'Phase' : 'Stage') : null,
        ])]),
        h('tbody', { role: 'rowgroup' }, rows.map(row => row.kind === 'prose'
          ? h('tr', { key: row.id, role: 'row' }, [h('td', { colspan: showStage ? 3 : 2, role: 'cell' }, [h('strong', row.label ?? ''), renderValue({ ...row, label: null }, false)])])
          : h('tr', { key: row.id, role: 'row' }, [
            h('td', { role: 'cell', headers: `${inputPrefix}-item` }, [
              h('div', { class: 'opportunity-context__requirement-heading' }, [renderValue({ ...row, text: undefined, children: undefined, evidence: undefined }, true, undefined, true), renderEvidence(row)]),
              row.children?.length ? h('div', { class: 'opportunity-context__requirement-details' }, [renderValue({ id: `${row.id}.details`, label: null, children: row.children }, false)]) : null,
            ]),
            h('td', { role: 'cell', headers: `${inputPrefix}-status`, class: 'opportunity-context__requirement-status', 'data-label': 'Status' }, requirementStatusLabel(row.requirementStatus)),
            showStage ? h('td', { role: 'cell', headers: `${inputPrefix}-stage`, class: 'opportunity-context__requirement-stage', 'data-label': props.lang === 'de' ? 'Phase' : 'Stage' }, stageLabel(row)) : null,
          ]))),
      ]);
      return h('table', { class: 'opportunity-context__requirements-table', 'aria-label': valueProps.node.label }, [
        h('thead', [h('tr', [
          h('th', { scope: 'col' }, props.lang === 'de' ? 'Eintrag' : 'Item'),
          h('th', { scope: 'col', class: 'opportunity-context__requirement-status' }, 'Status'),
        ])]),
        h('tbody', rows.map(row => {
          // Named entries already have an item/value structure. Keep the supplied
          // value in its own column, even when it is prose or an unknown status.
          const hasValue = !!row.label && (!!row.text || !!row.children?.length);
          const item = hasValue ? { ...row, text: undefined, href: undefined, children: undefined } : row;
          const statusLabelFor = props.checklist && row.checklistKey ? checklistInputId(row) : undefined;
          const statusValue = { ...row, label: null, checklistKey: undefined,
            children: row.children?.length === 1 ? [{ ...row.children[0], label: null }] : row.children };
          return h('tr', { key: row.id }, [
            h('td', [renderValue(item, true, undefined, true)]),
            h('td', { class: 'opportunity-context__requirement-status' }, [
              !hasValue || row.requirementStatusFields?.length ? h('span', requirementStatusLabel(row.requirementStatus)) : null,
              hasValue ? renderValue(statusValue, false, statusLabelFor) : null,
            ]),
          ]);
        })),
      ]);
    };
  },
});
</script>

<template>
  <div class="opportunity-context">
    <details v-for="group in groups" :key="group.id" class="opportunity-context__group disclosure-row" :class="`opportunity-context__group--${group.id}`" :open="(defaultOpenGroups ?? ['overview', 'salary', 'requirements', 'documents']).includes(group.id)">
      <summary><FontAwesomeIcon :icon="groupIcons[group.id]" class="disclosure-prefix" aria-hidden="true" />{{ group.label }} <span v-if="checklist && ['requirements', 'documents'].includes(group.id)" class="opportunity-context__progress">{{ progress(group.items) }}</span></summary>
      <ContextValue v-if="['requirements', 'documents'].includes(group.id)" class="opportunity-context__value" :node="{ id: group.id, label: group.label, children: group.items }" table />
      <div v-else class="opportunity-context__fields">
        <div v-for="item in group.items" :key="item.id" class="opportunity-context__field" :class="item.kind ? `opportunity-context__field--${item.kind}` : undefined">
          <dl>
            <dt>{{ item.label }} <SourceLinks :node="item" /></dt>
            <dd class="opportunity-context__value"><ContextValue :node="{ ...item, evidence: undefined }" /></dd>
          </dl>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.opportunity-context { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; min-width: 0; color: #c8ded5; }
.opportunity-context__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 24px; }
.opportunity-context__group--overview .opportunity-context__fields { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.opportunity-context__group--requirements .opportunity-context__fields,
.opportunity-context__group--documents .opportunity-context__fields { grid-template-columns: minmax(0, 1fr); }
.opportunity-context__field { min-width: 0; }
.opportunity-context__field dl { margin: 0; }
.opportunity-context__field--summary, .opportunity-context__field--main-link { grid-column: 1 / -1; }
.opportunity-context__field--living-standard { grid-column: 1 / -1; padding-bottom: 16px; border-bottom: 1px solid #2a5046; }
.opportunity-context :deep(.opportunity-context__living-standard-score) { font-size: 16px; font-variant-numeric: tabular-nums; color: #d7e8df; }
.opportunity-context :deep(.opportunity-context__living-standard > details > summary) { cursor: pointer; min-height: 44px; align-content: center; color: #9be8c7; }
.opportunity-context :deep(.opportunity-context__living-standard > details > summary:focus-visible) { outline: 2px solid #9be8c7; outline-offset: 3px; }
.opportunity-context__field--fit { padding: 15px; border: 1px solid #2a5046; border-radius: 8px; background: #102b30; }
.opportunity-context__field dt { margin-bottom: 5px; color: #91b4a7; font-size: 11px; font-weight: 600; }
.opportunity-context__value { margin: 0; color: #d7e8df; font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.opportunity-context :deep(.opportunity-context__requirements-table) { width: 100%; table-layout: fixed; border-collapse: collapse; text-align: left; }
.opportunity-context :deep(.opportunity-context__requirements-table th),
.opportunity-context :deep(.opportunity-context__requirements-table td) { padding: 10px 12px; vertical-align: top; border-bottom: 1px solid #2a5046; }
.opportunity-context :deep(.opportunity-context__requirements-table th) { color: #abc9bb; font-weight: 600; }
.opportunity-context :deep(.opportunity-context__requirements-table th:first-child),
.opportunity-context :deep(.opportunity-context__requirements-table td:first-child) { padding-left: 0; }
.opportunity-context :deep(.opportunity-context__requirements-table .opportunity-context__requirement-status) { width: 28%; padding-right: 0; }
.opportunity-context :deep(.opportunity-context__requirements-table--stages .opportunity-context__requirement-status),
.opportunity-context :deep(.opportunity-context__requirements-table--stages .opportunity-context__requirement-stage) { width: 20%; }
.opportunity-context :deep(.opportunity-context__requirement-details) { margin-top: 6px; }
.opportunity-context :deep(.opportunity-context__source-links) { display: inline-flex; flex-wrap: wrap; gap: 2px; max-width: 100%; margin-inline-start: 4px; vertical-align: middle; }
.opportunity-context :deep(.opportunity-context__source-link) { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; min-height: 28px; border-radius: 4px; font-size: 13px; line-height: 1; text-decoration: none; }
.opportunity-context :deep(.opportunity-context__source-link:hover) { background: #15362e; color: #c1f7de; }
.opportunity-context :deep(.opportunity-context__requirement-heading) { display: flex; align-items: flex-start; gap: 4px; }
.opportunity-context :deep(.opportunity-context__requirement-heading > .opportunity-context__checklist-item) { flex: 1; min-width: 0; }
.opportunity-context :deep(.opportunity-context__requirement-heading > .opportunity-context__source-links) { flex-shrink: 0; max-width: 40%; }
.opportunity-context :deep(.opportunity-context__requirements-table tbody tr:last-child td) { border-bottom: 0; }
.opportunity-context :deep(.opportunity-context__values) { display: grid; gap: 8px; }
.opportunity-context :deep(.opportunity-context__requirement-status > span + div) { margin-top: 8px; }
.opportunity-context__progress { margin-left: 12px; font-size: 11px; font-weight: 400; color: #a7c8ba; }
.opportunity-context :deep(.opportunity-context__checklist-item) { display: flex; align-items: flex-start; gap: 10px; }
.opportunity-context :deep(.opportunity-context__checklist-item > input[type=checkbox]) { flex: 0 0 16px; width: 16px; height: 16px; padding: 0; margin: 2px 0 0; accent-color: #65d8ac; cursor: pointer; }
.opportunity-context :deep(.opportunity-context__checklist-item > div) { flex: 1; min-width: 0; }
.opportunity-context :deep(.opportunity-context__checklist-label) { display: inline; font: inherit; color: inherit; cursor: pointer; }
.opportunity-context :deep(.opportunity-context__checklist-item > input:disabled + div label) { cursor: wait; }
.opportunity-context :deep(ul:has(> li > .opportunity-context__checklist-item)) { padding-left: 0; list-style: none; }
.opportunity-context :deep(.opportunity-context__checklist-item.is-complete > div) { color: #9bbaad; }
.opportunity-context :deep(.opportunity-context__list) { display: grid; gap: 8px; margin: 4px 0; padding-left: 18px; }
.opportunity-context :deep(.opportunity-context__list .opportunity-context__list) { margin-top: 3px; }
.opportunity-context :deep(.opportunity-context__prose) { margin: 4px 0; }
.opportunity-context :deep(.opportunity-context__nested-label) { color: #abc9bb; font-weight: 500; }
.opportunity-context :deep(.opportunity-context__missing) { color: #9bada7; font-style: italic; }
.opportunity-context :deep(.opportunity-context__score) { display: grid; gap: 8px; margin: 5px 0 16px; }
.opportunity-context :deep(.opportunity-context__score-details > summary) { min-height: 44px; align-content: center; cursor: pointer; list-style: none; border-radius: 3px; }
.opportunity-context :deep(.opportunity-context__score-details > summary::-webkit-details-marker) { display: none; }
.opportunity-context :deep(.opportunity-context__score-details > summary:focus-visible) { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.opportunity-context :deep(.opportunity-context__score-details:not([open]) > summary) { margin-bottom: 0; }
.opportunity-context :deep(.opportunity-context__score--red) { --score-color: var(--ui-score-red); --score-background: var(--ui-score-red-bg); }
.opportunity-context :deep(.opportunity-context__score--yellow) { --score-color: var(--ui-score-yellow); --score-background: var(--ui-score-yellow-bg); }
.opportunity-context :deep(.opportunity-context__score-number) { color: var(--score-color, #b7f3d9); font-size: 23px; font-variant-numeric: tabular-nums; line-height: 1.2; }
.opportunity-context :deep(.opportunity-context__score-track) { height: 10px; overflow: hidden; border-radius: 5px; background: var(--score-background, #071b20); border: 1px solid var(--score-color, #3c6256); }
.opportunity-context :deep(.opportunity-context__score-fill) { display: block; height: 100%; background: var(--score-color, #65d8ac); border-radius: inherit; }
.opportunity-context :deep(a) { color: #9be8c7; text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
.opportunity-context :deep(a:focus-visible) { outline: 2px solid #9be8c7; outline-offset: 3px; border-radius: 2px; }
@media (max-width: 760px) {
  .opportunity-context__group .opportunity-context__fields { grid-template-columns: minmax(0, 1fr); }
  .opportunity-context__field dt, .opportunity-context__progress { font-size: 14px; }
  .opportunity-context__value { font-size: 16px; line-height: 1.6; }
  .opportunity-context :deep(.opportunity-context__requirements-table .opportunity-context__requirement-status) { width: 38%; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical .opportunity-context__requirement-status),
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical .opportunity-context__requirement-stage) { width: auto; padding: 8px 0 0; overflow-wrap: normal; hyphens: auto; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical),
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical tbody) { display: block; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical thead) { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical tbody tr) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px; padding: 14px 0; border-bottom: 1px solid #2a5046; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical tbody tr:last-child) { border-bottom: 0; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical td) { display: block; min-width: 0; border: 0; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical td:first-child) { grid-column: 1 / -1; padding: 0; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical:not(.opportunity-context__requirements-table--stages) .opportunity-context__requirement-status) { grid-column: 1 / -1; }
  .opportunity-context :deep(.opportunity-context__requirements-table--canonical td[data-label]::before) { content: attr(data-label); display: block; color: #abc9bb; font-size: 12px; line-height: 1.5; margin-bottom: 2px; }
  .opportunity-context :deep(.opportunity-context__source-link) { min-width: 44px; min-height: 44px; font-size: 15px; }
  .opportunity-context :deep(.opportunity-context__checklist-item > input[type=checkbox]) { flex-basis: 20px; width: 20px; height: 20px; margin-top: 3px; }
  .opportunity-context :deep(.opportunity-context__checklist-label) { font-size: inherit; }
}
</style>
