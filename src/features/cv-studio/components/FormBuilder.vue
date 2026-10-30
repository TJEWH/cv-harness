<script setup lang="ts">
import { DEFAULT_SECTION_HEADER_SIZE, SAMPLE_CONTACT, designValue } from '../../../documents/cv/defaults';
import type { PropType } from 'vue';
import type { ContactField, CvState, SavedConfiguration, SaveStatus, CvItem, CustomSection, SidebarSection, ContentArea, CustomBodyField, ItemField, ItemState, SelectOption } from '../../../documents/cv/types';
import { CONTACT_FIELDS } from '../../../documents/cv/types';
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, useId, watch } from 'vue';
import Draggable from 'vuedraggable';
import SectionList from './SectionList.vue';
import CvSectionFrame from './CvSectionFrame.vue';
import SectionHeading from '../../../shared/ui/SectionHeading.vue';
import PrivacySectionHeading from '../../../documents/privacy/components/PrivacySectionHeading.vue';
import ContactFields from './ContactFields.vue';
import SectionItems from './SectionItems.vue';
import MarkdownTextarea from '../../../documents/cv/components/MarkdownTextarea.vue';
import InfoHint from '../../../shared/ui/InfoHint.vue';
import PrivacyField from '../../../documents/privacy/components/PrivacyField.vue';
import { PRIVACY_EDITOR } from '../../../documents/privacy/composables/privacyEditorContext';
import ConfirmDeletionDialog from '../../../shared/ui/ConfirmDeletionDialog.vue';
import SectionVersionSelect from './SectionVersionSelect.vue';
import CopyCvSection from './CopyCvSection.vue';
import { useSectionVersions } from '../composables/useSectionVersions.ts';
import { flushEditorSessionSync } from '../../../shared/editing/editorSession';
import { CV_TEXTAREA_COMMIT } from '../../../documents/cv/composables/cvTextareaCommit';
import { makeT } from '../../../i18n/dict.ts';
import { createContentId, moveSectionInOrder, normalizeContentState } from '../../../documents/layout/contentLayout.ts';

const props = defineProps({
  state: { type: Object as PropType<CvState>, required: true },
  configurations: { type: Array as PropType<SavedConfiguration[]>, default: () => [] },
  selectedId: { type: String, default: '' },
  toolbarTarget: { type: String, default: '' },
  toolbarVisible: { type: Boolean, default: true },
  privacyMode: { type: Boolean, default: false },
  readVersion: { type: Function as PropType<(id: string) => CvState | null | undefined>, required: true },
  saveVersion: { type: Function as PropType<(id: string, data: CvState) => boolean>, required: true },
});
const privacyEditor = inject(PRIVACY_EDITOR, null);
const visibilityLocked = (id: string) => Boolean(props.privacyMode && privacyEditor?.hiddenInContent(id));
const tabId = (tab: string) => `${props.privacyMode ? 'privacy' : 'content'}-tab-${tab}`;
const tabPanelId = (tab: string) => `${props.privacyMode ? 'privacy' : 'content'}-panel-${tab}`;
const emit = defineEmits<{ 'section-save-status': [status: SaveStatus] }>();

normalizeContentState(props.state);

const langRef = computed(() => props.state.lang);
const t = makeT(langRef);
const fieldConfigSectionId = ref<string | null>(null);
const fieldConfigDialog = ref<HTMLDialogElement | null>(null);
const editorId = useId();
const sectionContentId = (key: string) => `${editorId}-content-${key}`;
const activeContentTab = ref('body');
const sidebarContactCollapsed = ref(true);
const contactInSidebar = computed(() => props.state.design.contactLayout === 'sidebar');
const reorderMode = ref(false);
const touchReorderMedia = typeof window === 'undefined' ? undefined : window.matchMedia?.('(max-width: 760px), (any-pointer: coarse)');
const touchReorder = ref(touchReorderMedia?.matches ?? false);
const sectionDragHandle = computed(() => touchReorder.value ? '.section-drag-handle' : '.section-head, .section-drag-handle');
const syncTouchReorder = () => { touchReorder.value = touchReorderMedia?.matches ?? false; };
const todosMode = ref(false);
const configMode = ref(false);
const sectionVersions = useSectionVersions({
  state: () => props.state,
  selectedId: () => props.selectedId,
  configurations: () => props.configurations,
  readVersion: (id) => props.readVersion(id),
  saveVersion: (id, data) => props.saveVersion(id, data),
  onStatus: (status) => emit('section-save-status', status),
});
const commitParentTextarea = inject(CV_TEXTAREA_COMMIT, () => {});
provide(CV_TEXTAREA_COMMIT, () => {
  sectionVersions.flush();
  commitParentTextarea();
});
let sectionSessionEpoch = 0;
let sectionSessionDisposed = false;
watch(() => props.selectedId, () => { sectionSessionEpoch++; }, { flush: 'sync' });
onBeforeUnmount(() => { sectionSessionDisposed = true; sectionSessionEpoch++; });
function flushSectionSaves() {
  const epoch = sectionSessionEpoch;
  return flushEditorSessionSync({
    current: () => !sectionSessionDisposed && epoch === sectionSessionEpoch,
    steps: [() => sectionVersions.flush()],
  });
}
function resetSectionVersions() {
  const epoch = sectionSessionEpoch;
  return flushEditorSessionSync({
    current: () => !sectionSessionDisposed && epoch === sectionSessionEpoch,
    steps: [() => sectionVersions.reset()],
  });
}
const versionMode = sectionVersions.enabled;
const showConfig = computed(() => configMode.value && !versionMode.value && !reorderMode.value);
const sectionState = sectionVersions.sectionState;
const letterContactFields = computed<ContactField[]>({
  get: () => designValue(sectionState('header').design, 'letterContactFields'),
  set: (fields) => { sectionState('header').design.letterContactFields = fields; },
});
// Bind each section to its selected version. Keep the app state and preview
// on the selected whole version.
const state = computed(() => ({
  contact: sectionState('header').contact,
  about: sectionState('about').about,
  experience: sectionState('jobs').experience,
  get education() { return sectionState('education').education; },
  set education(value) { sectionState('education').education = value; },
  get languages() { return sectionState('languages').languages; },
  set languages(value) { sectionState('languages').languages = value; },
  get hobbies() { return sectionState('hobbies').hobbies; },
  set hobbies(value) { sectionState('hobbies').hobbies = value; },
  get bodyOrder() { return versionMode.value ? sectionVersions.order('body') : props.state.bodyOrder; },
  set bodyOrder(value) { props.state.bodyOrder = value; },
  get sidebarOrder() { return versionMode.value ? sectionVersions.order('sidebar') : props.state.sidebarOrder; },
  set sidebarOrder(value) { props.state.sidebarOrder = value; },
  sectionHeaderSizes: props.state.sectionHeaderSizes,
}));
const versionSelectProps = (key: string) => ({
  modelValue: sectionVersions.versionId(key),
  options: sectionVersions.options(key),
  label: `${t('sectionVersion')}: ${getSectionDisplayName(key)}`,
  draftLabel: t('currentDraft'),
});
const selectSectionVersion = (key: string, id: string) => {
  if (!flushSectionSaves()) return;
  pendingDeletion.value = null;
  sectionVersions.select(key, id);
};
defineExpose({ flush: flushSectionSaves, flushSectionSaves, resetSectionVersions });
const collapsed = reactive<Record<string, boolean>>({
  about: true,
  education: true,
  jobs: true,
  languages: true,
  hobbies: true,
});
const customCollapsed = reactive<Record<string, boolean>>({});
const editingSection = reactive<{ id: string | null; value: string }>({ id: null, value: '' });
const pendingDeletion = ref<{ message: string; remove(): void } | null>(null);

const builtInNames = computed<Record<string, string>>(() => ({
  header: t('headerTitle'),
  about: t('aboutTitle'),
  education: t('educationTitle'),
  jobs: t('expJobTitle'),
  languages: t('languagesTitle'),
  hobbies: t('hobbiesTitle'),
}));
const levelTypeOptions = computed(() => [
  { label: t('noLevel'), value: null },
  { label: t('experienceLevel'), value: 'experience' },
  { label: t('years'), value: 'years' },
]);

const isHidden = (key: string) => sectionState(key).disabled.includes(key);
const sidebarContactHidden = computed(() => sectionState('header').disabled.includes('sidebar-contact'));
const toggleSidebarContact = () => {
  const target = sectionState('header');
  target.disabled = sidebarContactHidden.value
    ? target.disabled.filter((key) => key !== 'sidebar-contact')
    : [...target.disabled, 'sidebar-contact'];
};
const isComplete = (key: string) => sectionState(key).completedSections.includes(key);
const isKeptTogether = (key: string) => sectionState(key).keepTogetherSections.includes(key);
const toggleKeepTogether = (key: string) => {
  if (isKeptTogether(key)) props.state.keepTogetherSections = props.state.keepTogetherSections.filter((item) => item !== key);
  else props.state.keepTogetherSections.push(key);
};
const contentTabSectionKeys = (tab: string) => {
  if (tab === 'header') return ['header'];
  return tab === 'body' ? props.state.bodyOrder : props.state.sidebarOrder;
};
const isContentTabComplete = (tab: string) => {
  const keys = contentTabSectionKeys(tab);
  return keys.length > 0 && keys.every(isComplete);
};
const toggleComplete = (key: string) => {
  const index = props.state.completedSections.indexOf(key);
  if (index === -1) props.state.completedSections.push(key);
  else props.state.completedSections.splice(index, 1);
};
const moveSection = (orderName: 'bodyOrder' | 'sidebarOrder', key: string, direction: number, event: Event) => {
  if (!reorderMode.value) return;
  const handle = event.currentTarget as HTMLElement;
  props.state[orderName] = moveSectionInOrder(props.state[orderName], key, direction);
  nextTick(() => handle.focus());
};
const toggleDisabled = (key: string) => {
  const target = sectionState(key);
  const index = target.disabled.indexOf(key);
  if (index === -1) target.disabled.push(key);
  else target.disabled.splice(index, 1);
};
const getBodySection = (id: string | null) => sectionState(id || '').customSections.find((section) => section.id === id);
const getSidebarSection = (id: string | null) => sectionState(id || '').sidebarSections.find((section) => section.id === id);
type BodyRow = { key: string; section: CustomSection | undefined };
type SidebarRow = { key: string; section: SidebarSection | undefined };
const bodyRows = computed<BodyRow[]>({
  get: () => state.value.bodyOrder.map((key) => ({ key, section: getBodySection(key) })),
  set: (rows) => { state.value.bodyOrder = rows.map(({ key }) => key); },
});
const sidebarRows = computed<SidebarRow[]>({
  get: () => state.value.sidebarOrder.map((key) => ({ key, section: getSidebarSection(key) })),
  set: (rows) => { state.value.sidebarOrder = rows.map(({ key }) => key); },
});
const getCustomSection = (id: string) => getBodySection(id) || getSidebarSection(id);
const activeFieldConfigSection = computed(() => getBodySection(fieldConfigSectionId.value));
const getSectionDisplayName = (key: string) => getCustomSection(key)?.name || sectionState(key).sectionNames[key] || builtInNames.value[key] || key;
const getDefaultName = (key: string) => builtInNames.value[key] || (t('newSection'));
const isCollapsed = (key: string) => {
  if (reorderMode.value) return key === 'about' || getBodySection(key)?.entryMode === 'textarea';
  return Object.hasOwn(collapsed, key) ? collapsed[key] : customCollapsed[key] ?? true;
};
const toggleCollapsed = (key: string) => {
  if (reorderMode.value) return;
  if (Object.hasOwn(collapsed, key)) collapsed[key] = !collapsed[key];
  else customCollapsed[key] = !isCollapsed(key);
};

const startEditSectionName = (key: string) => {
  if (!showConfig.value) return;
  const custom = getCustomSection(key);
  editingSection.id = key;
  editingSection.value = custom?.name || props.state.sectionNames[key] || '';
};
const focusSectionTitle = (key: string) => nextTick(() => document.getElementById(`${sectionContentId(key)}-heading`)?.focus());
const finishEditSectionName = (key: string, restoreFocus = false) => {
  if (editingSection.id !== key) return;
  const value = editingSection.value.trim();
  const custom = getCustomSection(key);
  if (custom) {
    if (value) custom.name = value;
  } else if (value && value !== getDefaultName(key)) {
    props.state.sectionNames = { ...props.state.sectionNames, [key]: value };
  } else {
    delete props.state.sectionNames[key];
  }
  editingSection.id = null;
  editingSection.value = '';
  if (restoreFocus) focusSectionTitle(key);
};
const cancelEditSectionName = (restoreFocus = false) => {
  const key = editingSection.id;
  editingSection.id = null;
  editingSection.value = '';
  if (restoreFocus && key) focusSectionTitle(key);
};
const toggleConfigMode = () => {
  if (!flushSectionSaves()) return;
  if (editingSection.id) finishEditSectionName(editingSection.id);
  closeFieldConfig();
  pendingDeletion.value = null;
  versionMode.value = false;
  reorderMode.value = false;
  configMode.value = !configMode.value;
};
const toggleReorderMode = () => {
  if (!flushSectionSaves()) return;
  versionMode.value = false;
  if (editingSection.id) finishEditSectionName(editingSection.id);
  closeFieldConfig();
  pendingDeletion.value = null;
  configMode.value = false;
  reorderMode.value = !reorderMode.value;
};
const selectContentTab = (tab: string) => {
  if (!flushSectionSaves()) return;
  activeContentTab.value = tab;
  // Header/contact fields are not part of either sortable section column.
  if (tab === 'header') reorderMode.value = false;
};
const onContentTabKeydown = (event: KeyboardEvent, currentTab: string) => {
  const tabs = ['header', 'body', 'sidebar'];
  const currentIndex = tabs.indexOf(currentTab);
  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  const nextTab = tabs[nextIndex]!;
  selectContentTab(nextTab);
  (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-content-tab="${nextTab}"]`)?.focus();
};
const editableTitleProps = (key: string) => ({
  editableTitle: showConfig.value,
  isEditingTitle: editingSection.id === key,
  editingTitleValue: editingSection.value,
  titlePlaceholder: getDefaultName(key),
});
const sectionFrameProps = (key: string, area: ContentArea) => ({
  contentId: sectionContentId(key), lang: langRef.value, title: getSectionDisplayName(key),
  disabled: isHidden(key), completed: isComplete(key), collapsed: isCollapsed(key),
  visibilityLocked: visibilityLocked(key),
  visibilityLabel: `${t(isHidden(key) ? 'show' : 'hide')}: ${getSectionDisplayName(key)}`,
  modes: { config: showConfig.value, reorder: reorderMode.value, versions: versionMode.value, todos: todosMode.value },
  titleEditor: { editable: showConfig.value, editing: editingSection.id === key, value: editingSection.value,
    placeholder: key === 'about' ? getDefaultName(key) : undefined },
  headerSize: key === 'about' ? state.value.sectionHeaderSizes[key] ?? DEFAULT_SECTION_HEADER_SIZE : state.value.sectionHeaderSizes[key],
  keepTogether: area === 'body' ? isKeptTogether(key) : undefined,
});
const sectionFrameEvents = (key: string) => ({
  'toggle-section': () => toggleDisabled(key),
  'toggle-collapse': () => toggleCollapsed(key),
  'toggle-complete': () => toggleComplete(key),
  'toggle-keep-together': () => toggleKeepTogether(key),
  'start-edit-title': () => startEditSectionName(key),
  'finish-edit-title': (restoreFocus: boolean) => finishEditSectionName(key, restoreFocus),
  'cancel-edit-title': (restoreFocus: boolean) => cancelEditSectionName(restoreFocus),
  'update-editing-value': (value: string) => { editingSection.value = value; },
  'header-size-change': (value: string) => { state.value.sectionHeaderSizes[key] = value; },
});
watch(() => editingSection.id, (key) => {
  if (!key) return;
  nextTick(() => document.querySelector<HTMLInputElement>('.section-name-input')?.focus());
});

const addBodySection = () => {
  const section: CustomSection = {
    id: createContentId('body'),
    name: t('newSection'),
    entryMode: 'fields',
    text: '',
    fields: ['title', 'institution', 'place', 'start', 'end', 'state', 'desc'],
    entries: [],
  };
  addBodyEntry(section);
  props.state.customSections.push(section);
  props.state.bodyOrder.push(section.id);
  props.state.sectionHeaderSizes[section.id] = DEFAULT_SECTION_HEADER_SIZE;
  customCollapsed[section.id] = false;
};
const addSidebarSection = () => {
  const section: SidebarSection = {
    id: createContentId('sidebar'),
    name: t('newSidebarSection'),
    levelType: null,
    items: [],
  };
  addSidebarItem(section);
  props.state.sidebarSections.push(section);
  props.state.sidebarOrder.push(section.id);
  props.state.sectionHeaderSizes[section.id] = DEFAULT_SECTION_HEADER_SIZE;
  customCollapsed[section.id] = false;
};
const deleteCustomSection = (section: CustomSection | SidebarSection, area: ContentArea) => {
  const sections = area === 'body' ? props.state.customSections : props.state.sidebarSections;
  const orderName = area === 'body' ? 'bodyOrder' : 'sidebarOrder';
  const index = sections.findIndex((item) => item.id === section.id);
  if (index !== -1) sections.splice(index, 1);
  props.state[orderName] = props.state[orderName].filter((key: string) => key !== section.id);
  props.state.disabled = props.state.disabled.filter((key: string) => key !== section.id);
  props.state.completedSections = props.state.completedSections.filter((key: string) => key !== section.id);
  props.state.keepTogetherSections = props.state.keepTogetherSections.filter((key: string) => key !== section.id);
  delete customCollapsed[section.id];
};
const addBodyEntry = (section: CustomSection) => section.entries.push({ id: createContentId('entry'), hidden: false, title: '', institution: '', place: '', start: '', end: '', desc: '' });
const removeBodyEntry = (section: CustomSection, index: number) => section.entries.splice(index, 1);
const addSidebarItem = (section: SidebarSection) => section.items.push({ id: createContentId('skill'), hidden: false, name: '', levelValue: 0 });
const removeSidebarItem = (section: SidebarSection, index: number) => section.items.splice(index, 1);
const requestDeletion = (message: string, remove: () => void) => { pendingDeletion.value = { message, remove }; };
const requestSectionDeletion = (section: CustomSection | SidebarSection, area: ContentArea) => requestDeletion(t('confirmDeleteSection'), () => deleteCustomSection(section, area));
const requestBodyEntryDeletion = (section: CustomSection, index: number) => requestDeletion(t('confirmDeleteItem'), () => removeBodyEntry(section, index));
const requestSidebarItemDeletion = (section: SidebarSection, index: number) => requestDeletion(t('confirmDeleteItem'), () => removeSidebarItem(section, index));
const confirmDeletion = () => {
  pendingDeletion.value?.remove();
  pendingDeletion.value = null;
};
const cancelDeletion = () => { pendingDeletion.value = null; };
const toggleItemHidden = (item: CvItem) => { item.hidden = !item.hidden; };
const closeFieldConfig = () => {
  fieldConfigDialog.value?.close();
  fieldConfigSectionId.value = null;
};
watch(fieldConfigSectionId, async (key) => {
  if (!key) return;
  await nextTick();
  if (fieldConfigSectionId.value && !fieldConfigDialog.value?.open) fieldConfigDialog.value?.showModal();
});
const openFieldConfig = (section: CustomSection) => { fieldConfigSectionId.value = section.id; };
const itemStateOptions = computed<SelectOption<ItemState | ''>[]>(() => [
  { label: t('noState'), value: '' },
  { label: t('planned'), value: 'planned' },
  { label: t('ongoing'), value: 'ongoing' },
  { label: t('complete'), value: 'complete' },
]);
const customBodyFieldOptions = computed<(ItemField & { key: CustomBodyField })[]>(() => [
  { key: 'title', label: t('title'), type: 'text', placeholder: t('customSectionPH') },
  { key: 'institution', label: t('institution'), type: 'text', placeholder: t('organizationPlaceholder') },
  { key: 'place', label: t('place'), type: 'text', placeholder: 'Berlin' },
  { key: 'start', label: t('start'), type: 'text', placeholder: '04.2024' },
  { key: 'end', label: t('end'), type: 'text', placeholder: t('current') },
  { key: 'state', label: t('state'), type: 'select', options: itemStateOptions.value },
  { key: 'desc', label: t('desc'), type: 'textarea', placeholder: '' },
]);
const enabledCustomBodyEntryFields = (section: CustomSection) => customBodyFieldOptions.value.filter((field) => field.type !== 'textarea' && section.fields?.includes(field.key));
const isCustomBodyFieldEnabled = (section: CustomSection, key: CustomBodyField) => section.fields?.includes(key);
const usesCustomBodyTextarea = (section: CustomSection) => section.entryMode === 'textarea';
const setCustomBodyEntryMode = (section: CustomSection, mode: string) => {
  section.entryMode = mode === 'textarea' ? 'textarea' : 'fields';
};
const setCustomBodyFieldEnabled = (section: CustomSection, key: CustomBodyField, enabled: boolean) => {
  const selected = new Set(section.fields);
  if (enabled) selected.add(key);
  else selected.delete(key);
  section.fields = customBodyFieldOptions.value.map((field) => field.key).filter((field) => selected.has(field));
};
onMounted(() => {
  window.addEventListener('pagehide', flushSectionSaves);
  touchReorderMedia?.addEventListener('change', syncTouchReorder);
});
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flushSectionSaves);
  touchReorderMedia?.removeEventListener('change', syncTouchReorder);
});

const educationSchema = computed<ItemField[]>(() => [
  { label: t('degreeTitle'), key: 'title', type: 'text', placeholder: t('degreePlaceholder') },
  { label: t('institution'), key: 'sub', type: 'text', placeholder: t('universityPlaceholder') },
  { label: t('place'), key: 'place', type: 'text', placeholder: 'Hamburg' },
  { label: t('start'), key: 'start', type: 'text', placeholder: '2017' },
  { label: t('end'), key: 'end', type: 'text', placeholder: '2020' },
  { label: t('thesis'), key: 'thesis', type: 'textarea', placeholder: t('thesisPlaceholder') },
  { label: t('modulesCourses'), key: 'coursesText', type: 'textarea', placeholder: t('coursesPlaceholder') },
]);
const jobsSchema = computed<ItemField[]>(() => [
  { label: t('position'), key: 'title', type: 'text', placeholder: t('seniorRolePlaceholder') },
  { label: t('company'), key: 'company', type: 'text', placeholder: 'Acme GmbH' },
  { label: t('place'), key: 'place', type: 'text', placeholder: 'Berlin' },
  { label: t('start'), key: 'start', type: 'text', placeholder: '05.2021' },
  { label: t('end'), key: 'end', type: 'text', placeholder: t('current') },
  { label: t('bulletsLabel'), key: 'bullets', type: 'textarea', placeholder: t('tasksPH') },
]);
const languagesSchema = computed<ItemField[]>(() => [
  { label: t('languageName'), key: 'name', type: 'text', placeholder: t('german') },
  { label: t('level'), key: 'level', type: 'select', options: [t('nativeLanguage'), 'C2', 'C1', 'B2', 'B1', 'A2', 'A1'].map((value) => ({ label: value, value })) },
]);
const hobbiesSchema = computed<ItemField[]>(() => [{ label: t('hobby'), key: 'name', type: 'text', placeholder: t('hobbyPlaceholder') }]);
</script>

<template>
  <form class="builder builder--cli" @submit.prevent>
    <ConfirmDeletionDialog
      :visible="Boolean(pendingDeletion)"
      :title="t('confirmDeletion')"
      :message="pendingDeletion?.message || ''"
      :cancel-label="t('cancel')"
      :confirm-label="t('delete')"
      @cancel="cancelDeletion"
      @confirm="confirmDeletion"
    />
    <Teleport to="body">
      <dialog v-if="activeFieldConfigSection" ref="fieldConfigDialog" class="field-config-backdrop" :aria-labelledby="`${editorId}-field-config-title`" @cancel.prevent="closeFieldConfig" @click.self="closeFieldConfig">
          <section class="field-config-dialog">
            <header class="field-config-dialog__header">
              <div class="field-config-dialog__title">
                <h3 :id="`${editorId}-field-config-title`">{{ t('fieldConfiguration') }}</h3>
                <p>{{ getSectionDisplayName(activeFieldConfigSection.id) }}</p>
              </div>
              <button class="mini field-config-dialog__close" type="button" :aria-label="t('close')" :title="t('close')" @click="closeFieldConfig"><font-awesome-icon :icon="['fas', 'xmark']" /></button>
            </header>
            <fieldset class="field-config-mode">
              <legend>{{ t('fieldInputMode') }}<InfoHint :id="`${editorId}-field-config-help`" :lang="langRef" :label="t('fieldInputMode')" :text="usesCustomBodyTextarea(activeFieldConfigSection) ? t('textareaFieldHelp') : t('fieldConfigurationHelp')" /></legend>
              <div class="field-config-options">
                <label class="field-config-option"><input type="radio" :name="`${editorId}-custom-field-mode`" :checked="!usesCustomBodyTextarea(activeFieldConfigSection)" @change="setCustomBodyEntryMode(activeFieldConfigSection, 'fields')" /><span>{{ t('fieldInputModeFields') }}</span></label>
                <label class="field-config-option"><input type="radio" :name="`${editorId}-custom-field-mode`" :checked="usesCustomBodyTextarea(activeFieldConfigSection)" @change="setCustomBodyEntryMode(activeFieldConfigSection, 'textarea')" /><span>{{ t('fieldInputModeTextarea') }}</span></label>
              </div>
            </fieldset>
            <div v-if="!usesCustomBodyTextarea(activeFieldConfigSection)" class="field-config-options" role="group" :aria-label="t('fields')" :aria-describedby="`${editorId}-field-config-help`">
              <label v-for="field in customBodyFieldOptions" :key="field.key" class="field-config-option">
                <input type="checkbox" :checked="isCustomBodyFieldEnabled(activeFieldConfigSection, field.key)" @change="setCustomBodyFieldEnabled(activeFieldConfigSection, field.key, ($event.target as HTMLInputElement).checked)" />
                <span>{{ field.label }}</span>
              </label>
            </div>
          </section>
      </dialog>
    </Teleport>
    <section class="body section-group editor-panel content-panel" :class="{ 'is-reordering': reorderMode && activeContentTab !== 'header', 'uses-touch-reorder': touchReorder }">
      <slot name="before-tabs" />
      <div class="content-tabs" role="tablist" :aria-label="t(privacyMode ? 'privacy' : 'content')">
        <button :id="tabId('header')" data-content-tab="header" :tabindex="activeContentTab === 'header' ? 0 : -1" @keydown="onContentTabKeydown($event, 'header')" class="content-tab" :class="{ active: activeContentTab === 'header' }" type="button" role="tab" :aria-selected="activeContentTab === 'header'" :aria-controls="tabPanelId('header')" @click="selectContentTab('header')"><span>{{ t('header') }}</span><font-awesome-icon v-if="todosMode && isContentTabComplete('header')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
        <button :id="tabId('body')" data-content-tab="body" :tabindex="activeContentTab === 'body' ? 0 : -1" @keydown="onContentTabKeydown($event, 'body')" class="content-tab" :class="{ active: activeContentTab === 'body' }" type="button" role="tab" :aria-selected="activeContentTab === 'body'" :aria-controls="tabPanelId('body')" @click="selectContentTab('body')"><span>{{ t('body') }}</span><font-awesome-icon v-if="todosMode && isContentTabComplete('body')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
        <button :id="tabId('sidebar')" data-content-tab="sidebar" :tabindex="activeContentTab === 'sidebar' ? 0 : -1" @keydown="onContentTabKeydown($event, 'sidebar')" class="content-tab" :class="{ active: activeContentTab === 'sidebar' }" type="button" role="tab" :aria-selected="activeContentTab === 'sidebar'" :aria-controls="tabPanelId('sidebar')" @click="selectContentTab('sidebar')"><span>{{ t('sidebar') }}</span><font-awesome-icon v-if="todosMode && isContentTabComplete('sidebar')" class="content-tab__complete" :icon="['fas', 'check']" aria-hidden="true" /></button>
      </div>

      <div class="content-panel__scroll-body">
      <slot name="before-content" />

      <section v-show="activeContentTab === 'header'" :id="tabPanelId('header')" class="section-group content-section content-tab-panel" role="tabpanel" :aria-labelledby="tabId('header')" :class="{ disabled: isHidden('header'), completed: todosMode && isComplete('header') }">
        <div class="section-head">
          <button class="mini visibility-toggle" :class="isHidden('header') ? 'btn--success' : 'btn--danger'" type="button" :aria-label="isHidden('header') ? t('show') : t('hide')" :title="isHidden('header') ? t('show') : t('hide')" :disabled="visibilityLocked('header')" @click.stop="toggleDisabled('header')"><font-awesome-icon :icon="['fas', isHidden('header') ? 'eye-slash' : 'eye']" /></button>
          <h3 class="section-name-label section-name-label--static">{{ t('headerTitle') }}</h3>
          <SectionVersionSelect v-if="versionMode" v-bind="versionSelectProps('header')" @update:model-value="selectSectionVersion('header', $event)" />
          <div v-else class="section-head__actions"><label v-if="todosMode" class="section-complete-toggle" :title="t('markComplete')" @click.stop><input type="checkbox" :checked="isComplete('header')" :aria-label="t('markComplete')" @change="toggleComplete('header')" /></label></div>
        </div>
        <div class="grid-2"><PrivacyField :owner="state.contact" field="name" v-slot="{ disabled }"><label>{{ t('name') }}<InputText :disabled="disabled" v-model="state.contact.name" :placeholder="SAMPLE_CONTACT.name" fluid /></label></PrivacyField><PrivacyField :owner="state.contact" field="role" v-slot="{ disabled }"><label>{{ t('role') }}<InputText :disabled="disabled" v-model="state.contact.role" :placeholder="SAMPLE_CONTACT.role" fluid /></label></PrivacyField></div>
        <ContactFields v-if="!contactInSidebar" :contact="state.contact" :lang="langRef" />
        <fieldset v-if="!privacyMode" class="letter-contact-fields" :aria-describedby="`${editorId}-letter-contact-help`">
          <legend>{{ t('letterContactFields') }}<InfoHint :id="`${editorId}-letter-contact-help`" :lang="langRef" :label="t('letterContactFields')" :text="t('letterContactFieldsHelp')" /></legend>
          <div class="letter-contact-fields__options">
            <label v-for="field in CONTACT_FIELDS" :key="field" class="letter-contact-fields__option">
              <input v-model="letterContactFields" type="checkbox" :value="field" />
              <span>{{ t(field) }}</span>
            </label>
          </div>
        </fieldset>
      </section>

      <Draggable v-show="activeContentTab === 'body'" :id="tabPanelId('body')" v-model="bodyRows" item-key="key" tag="section" class="content-tab-panel content-column" role="tabpanel" :aria-labelledby="tabId('body')" :disabled="!reorderMode" :handle="sectionDragHandle" :animation="150" ghost-class="sortable-ghost">
          <template #item="{ element: { key, section } }: { element: BodyRow }">
            <div class="content-section-card" :data-section-key="key">
              <button v-if="reorderMode" class="section-drag-handle" type="button" :aria-label="`${t('moveSection')}: ${getSectionDisplayName(key)}`" :title="t('moveSection')" @click.stop @keydown.up.prevent.stop="moveSection('bodyOrder', key, -1, $event)" @keydown.down.prevent.stop="moveSection('bodyOrder', key, 1, $event)"><font-awesome-icon :icon="['fas', 'grip-vertical']" aria-hidden="true" /></button>
            <CvSectionFrame v-if="key === 'about'" class="content-section" v-bind="sectionFrameProps(key, 'body')" v-on="sectionFrameEvents(key)">
              <template v-if="privacyMode" #heading><PrivacySectionHeading :owner="props.state.sectionNames" :field="key" :placeholder="builtInNames[key]" :title="getSectionDisplayName(key)" :lang="langRef" :collapsed="isCollapsed(key)" :controls="sectionContentId(key)" @toggle-collapse="toggleCollapsed(key)" /></template>
              <template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template>
              <PrivacyField :owner="state.about" field="text" v-slot="{ disabled }"><div class="markdown-field about-editor"><div class="hint-label-row"><label :for="`${editorId}-about-text`">{{ t('aboutTextLabel') }}</label><InfoHint :id="`${editorId}-about-text-help`" :lang="langRef" :label="t('aboutTextLabel')" :text="t('markdownTextareaHelp')" /></div><MarkdownTextarea :id="`${editorId}-about-text`" :disabled="disabled" v-model="state.about.text" :aria-label="t('aboutTextLabel')" placeholder="Me in a nutshell..." :aria-describedby="`${editorId}-about-text-help`" :rows="4" /></div></PrivacyField>
            </CvSectionFrame>

            <SectionList
              v-else-if="key === 'education'"
              class="content-section"
              :version-mode="versionMode" :privacy-mode="privacyMode"
              :todos-mode="todosMode" :config-mode="showConfig" :reorder-mode="reorderMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="education" v-model="state.education" :schema="educationSchema" :add-label="privacyMode ? '' : t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" :show-keep-together="true" :keep-together="isKeptTogether(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] ?? DEFAULT_SECTION_HEADER_SIZE" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-keep-together="toggleKeepTogether(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName()" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #heading="{ controls }" v-if="privacyMode"><PrivacySectionHeading :owner="props.state.sectionNames" :field="key" :placeholder="builtInNames[key]" :title="getSectionDisplayName(key)" :lang="langRef" :collapsed="isCollapsed(key)" :controls="controls" @toggle-collapse="toggleCollapsed(key)" /></template><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <SectionList
              v-else-if="key === 'jobs'"
              class="content-section"
              :version-mode="versionMode" :privacy-mode="privacyMode"
              :todos-mode="todosMode" :config-mode="showConfig" :reorder-mode="reorderMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="jobs" v-model="state.experience.jobs" :schema="jobsSchema" :add-label="privacyMode ? '' : t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" :show-keep-together="true" :keep-together="isKeptTogether(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] ?? DEFAULT_SECTION_HEADER_SIZE" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-keep-together="toggleKeepTogether(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName()" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #heading="{ controls }" v-if="privacyMode"><PrivacySectionHeading :owner="props.state.sectionNames" :field="key" :placeholder="builtInNames[key]" :title="getSectionDisplayName(key)" :lang="langRef" :collapsed="isCollapsed(key)" :controls="controls" @toggle-collapse="toggleCollapsed(key)" /></template><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <CvSectionFrame v-else-if="section" class="content-section" v-bind="sectionFrameProps(key, 'body')" v-on="sectionFrameEvents(key)">
              <template v-if="privacyMode" #heading><PrivacySectionHeading :owner="section" field="name"  :title="getSectionDisplayName(key)" :lang="langRef" :collapsed="isCollapsed(key)" :controls="sectionContentId(key)" @toggle-collapse="toggleCollapsed(key)" /></template>
              <template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template>
              <template v-if="showConfig" #actions>
                <button class="section-header-control section-header-control--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click.stop="requestSectionDeletion(section, 'body')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
                <button class="section-header-control section-fields-control" type="button" :aria-label="t('fields')" :title="t('fields')" @click.stop="openFieldConfig(section)"><font-awesome-icon :icon="['fas', 'sliders']" aria-hidden="true" /><span>{{ t('fields') }}</span></button>
              </template>
              <PrivacyField :owner="section" field="text" v-if="usesCustomBodyTextarea(section)" v-slot="{ disabled }"><div class="markdown-field about-editor"><div class="hint-label-row"><label :for="`${editorId}-${section.id}-text`">{{ t('textarea') }}</label><InfoHint :id="`${editorId}-${section.id}-text-help`" :lang="langRef" :label="t('textarea')" :text="t('markdownTextareaHelp')" /></div><MarkdownTextarea :id="`${editorId}-${section.id}-text`" :disabled="disabled" v-model="section.text" :aria-label="t('textarea')" :aria-describedby="`${editorId}-${section.id}-text-help`" :rows="6" /></div></PrivacyField>
              <template v-else>
                <SectionItems v-model="section.entries" :lang="langRef" :reorder-mode="reorderMode">
                  <template #default="{ item: entry, index }">
                    <div class="item-row__actions"><button class="mini visibility-toggle" :class="entry.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="entry.hidden ? t('show') : t('hide')" :title="entry.hidden ? t('show') : t('hide')" :disabled="visibilityLocked(entry.id)" @click="toggleItemHidden(entry)"><font-awesome-icon :icon="['fas', entry.hidden ? 'eye-slash' : 'eye']" /></button><button v-if="showConfig" class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="requestBodyEntryDeletion(section, index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                    <div class="item-row__content">
                      <div v-if="enabledCustomBodyEntryFields(section).length" class="custom-body-entry__fields" :style="{ '--custom-body-field-count': enabledCustomBodyEntryFields(section).length }">
                        <PrivacyField :owner="entry" :field="field.key" v-for="field in enabledCustomBodyEntryFields(section)" :key="field.key" v-slot="{ disabled }"><label>{{ field.label }}<InputText :disabled="disabled" v-if="field.type === 'text'" v-model="entry[field.key]" :placeholder="field.placeholder" fluid /><Select :disabled="disabled" v-else-if="field.type === 'select'" v-model="entry[field.key]" :options="field.options" option-label="label" option-value="value" :aria-label="field.label" fluid /></label></PrivacyField>
                      </div>
                      <PrivacyField :owner="entry" field="desc" v-if="isCustomBodyFieldEnabled(section, 'desc')" v-slot="{ disabled }"><div class="markdown-field"><div class="hint-label-row"><label :for="`${editorId}-${section.id}-${entry.id}-desc`">{{ t('desc') }}</label><InfoHint :id="`${editorId}-${section.id}-${entry.id}-desc-help`" :lang="langRef" :label="t('desc')" :text="t('markdownTextareaHelp')" /></div><MarkdownTextarea :id="`${editorId}-${section.id}-${entry.id}-desc`" :disabled="disabled" v-model="entry.desc" :aria-label="t('desc')" :placeholder="customBodyFieldOptions.find((field) => field.key === 'desc')?.placeholder" :aria-describedby="`${editorId}-${section.id}-${entry.id}-desc-help`" /></div></PrivacyField>
                    </div>
                  </template>
                </SectionItems>
                <button v-if="!privacyMode && !reorderMode" type="button" class="add-item-row" @click="addBodyEntry(section)"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ t('addItem') }}</button>
              </template>
            </CvSectionFrame>
            </div>
          </template>
          <template #footer>
          <button v-if="!privacyMode && !reorderMode && !versionMode" type="button" class="add-section-row" @click="addBodySection">
            <font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />
            {{ t('addSection') }}
          </button>
          </template>
      </Draggable>

      <Draggable v-show="activeContentTab === 'sidebar'" :id="tabPanelId('sidebar')" v-model="sidebarRows" item-key="key" tag="section" class="content-tab-panel content-column" role="tabpanel" :aria-labelledby="tabId('sidebar')" :disabled="!reorderMode" :handle="sectionDragHandle" :animation="150" ghost-class="sortable-ghost">
          <template #header>
            <section v-if="contactInSidebar" class="section-group content-section" :class="{ collapsed: sidebarContactCollapsed, disabled: sidebarContactHidden }">
              <div class="section-head" @click="sidebarContactCollapsed = !sidebarContactCollapsed">
                <button class="mini visibility-toggle" :class="sidebarContactHidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="sidebarContactHidden ? t('show') : t('hide')" :title="sidebarContactHidden ? t('show') : t('hide')" :disabled="visibilityLocked('sidebar-contact')" @click.stop="toggleSidebarContact"><font-awesome-icon :icon="['fas', sidebarContactHidden ? 'eye-slash' : 'eye']" /></button>
                <SectionHeading :title="t('headerTitle')" :collapsed="sidebarContactCollapsed" :controls="sectionContentId('sidebar-contact')" @activate="sidebarContactCollapsed = !sidebarContactCollapsed" />
                <SectionVersionSelect v-if="versionMode" v-bind="versionSelectProps('header')" @click.stop @update:model-value="selectSectionVersion('header', $event)" />
              </div>
              <div :id="sectionContentId('sidebar-contact')" class="section-content" :inert="sidebarContactCollapsed"><div class="section-content__inner">
                <ContactFields :contact="state.contact" :lang="langRef" />
              </div></div>
            </section>
          </template>
          <template #item="{ element: { key, section } }: { element: SidebarRow }">
            <div class="content-section-card" :data-section-key="key">
              <button v-if="reorderMode" class="section-drag-handle" type="button" :aria-label="`${t('moveSection')}: ${getSectionDisplayName(key)}`" :title="t('moveSection')" @click.stop @keydown.up.prevent.stop="moveSection('sidebarOrder', key, -1, $event)" @keydown.down.prevent.stop="moveSection('sidebarOrder', key, 1, $event)"><font-awesome-icon :icon="['fas', 'grip-vertical']" aria-hidden="true" /></button>
            <SectionList
              v-if="key === 'languages'"
              class="content-section"
              :version-mode="versionMode" :privacy-mode="privacyMode"
              :todos-mode="todosMode" :config-mode="showConfig" :reorder-mode="reorderMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="languages" v-model="state.languages" :schema="languagesSchema" :add-label="privacyMode ? '' : t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] ?? DEFAULT_SECTION_HEADER_SIZE" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName()" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #heading="{ controls }" v-if="privacyMode"><PrivacySectionHeading :owner="props.state.sectionNames" :field="key" :placeholder="builtInNames[key]" :title="getSectionDisplayName(key)" :lang="langRef" :collapsed="isCollapsed(key)" :controls="controls" @toggle-collapse="toggleCollapsed(key)" /></template><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <SectionList
              v-else-if="key === 'hobbies'"
              class="content-section"
              :version-mode="versionMode" :privacy-mode="privacyMode"
              :todos-mode="todosMode" :config-mode="showConfig" :reorder-mode="reorderMode"
              :title="getSectionDisplayName(key)" :lang="langRef" section-key="hobbies" v-model="state.hobbies" :schema="hobbiesSchema" :add-label="privacyMode ? '' : t('addItem')" :disabled="isHidden(key)" :completed="isComplete(key)" :is-collapsed="isCollapsed(key)" v-bind="editableTitleProps(key)"
              :header-size="state.sectionHeaderSizes[key] ?? DEFAULT_SECTION_HEADER_SIZE" @toggle-section="toggleDisabled(key)" @toggle-complete="toggleComplete(key)" @toggle-collapse="toggleCollapsed(key)" @start-edit-title="startEditSectionName(key)" @finish-edit-title="finishEditSectionName(key)" @cancel-edit-title="cancelEditSectionName()" @update-editing-value="editingSection.value = $event" @header-size-change="state.sectionHeaderSizes[key] = $event"
            ><template #heading="{ controls }" v-if="privacyMode"><PrivacySectionHeading :owner="props.state.sectionNames" :field="key" :placeholder="builtInNames[key]" :title="getSectionDisplayName(key)" :lang="langRef" :collapsed="isCollapsed(key)" :controls="controls" @toggle-collapse="toggleCollapsed(key)" /></template><template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template></SectionList>
            <CvSectionFrame v-else-if="section" class="content-section" v-bind="sectionFrameProps(key, 'sidebar')" v-on="sectionFrameEvents(key)">
              <template v-if="privacyMode" #heading><PrivacySectionHeading :owner="section" field="name"  :title="getSectionDisplayName(key)" :lang="langRef" :collapsed="isCollapsed(key)" :controls="sectionContentId(key)" @toggle-collapse="toggleCollapsed(key)" /></template>
              <template #section-version><SectionVersionSelect v-bind="versionSelectProps(key)" @update:model-value="selectSectionVersion(key, $event)" /></template>
              <template v-if="showConfig" #actions>
                <button class="section-header-control section-header-control--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click.stop="requestSectionDeletion(section, 'sidebar')"><font-awesome-icon :icon="['fas', 'trash']" /></button>
                <Select v-model="section.levelType" class="section-level-select" :options="levelTypeOptions" option-label="label" option-value="value" :aria-label="t('levelType')" :title="t('levelType')" />
              </template>
              <SectionItems v-model="section.items" :lang="langRef" :reorder-mode="reorderMode">
                <template #default="{ item, index }">
                  <div class="item-row__actions"><button class="mini visibility-toggle" :class="item.hidden ? 'btn--success' : 'btn--danger'" type="button" :aria-label="item.hidden ? t('show') : t('hide')" :title="item.hidden ? t('show') : t('hide')" :disabled="visibilityLocked(item.id)" @click="toggleItemHidden(item)"><font-awesome-icon :icon="['fas', item.hidden ? 'eye-slash' : 'eye']" /></button><button v-if="showConfig" class="mini btn--danger" type="button" :aria-label="t('remove')" :title="t('remove')" @click="requestSidebarItemDeletion(section, index)"><font-awesome-icon :icon="['fas', 'trash']" /></button></div>
                  <div class="item-row__content sidebar-skill-row__content">
                    <PrivacyField :owner="item" field="name" v-slot="{ disabled }"><label>{{ t('skillName') }}<InputText :disabled="disabled" v-model="item.name" :placeholder="t('skillPlaceholder')" fluid /></label></PrivacyField>
                    <PrivacyField :owner="item" field="levelValue" v-if="section.levelType" v-slot="{ disabled }"><label>{{ t('levelValue') }}<InputNumber :disabled="disabled" :model-value="item.levelValue" @update:model-value="item.levelValue = $event ?? 0" :min="section.levelType === 'experience' ? 1 : 0" :max="section.levelType === 'experience' ? 10 : 99" :use-grouping="false" fluid /></label></PrivacyField>
                  </div>
                </template>
              </SectionItems>
              <button v-if="!privacyMode && !reorderMode" type="button" class="add-item-row" @click="addSidebarItem(section)"><font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />{{ t('addItem') }}</button>
            </CvSectionFrame>
            </div>
          </template>
          <template #footer>
          <button v-if="!privacyMode && !reorderMode && !versionMode" type="button" class="add-section-row" @click="addSidebarSection">
            <font-awesome-icon :icon="['fas', 'plus']" aria-hidden="true" />
            {{ t('addSection') }}
          </button>
          </template>
      </Draggable>
      <CopyCvSection v-if="!privacyMode" :state="props.state" :configurations="configurations" :read-version="readVersion" />
      </div>
      <Teleport v-if="!privacyMode" defer :to="toolbarTarget || 'body'" :disabled="!toolbarTarget">
        <div v-show="toolbarVisible" class="content-mode-toolbar" :class="{ 'content-mode-toolbar--docked': !!toolbarTarget, 'content-mode-toolbar--sidebar': toolbarTarget.startsWith('#desktop-sidebar-') }" role="group" :aria-label="t('contentTools')">
          <div class="panel-header-action content-mode-actions content-mode-actions--left">
            <div class="content-mode-tool"><button class="mini content-reorder-toggle" type="button" :class="{ 'is-active': todosMode }" :aria-pressed="todosMode" :aria-describedby="`${editorId}-todos-help`" @click="todosMode = !todosMode"><font-awesome-icon :icon="['fas', 'check']" aria-hidden="true" />{{ t('todos') }}</button><InfoHint :id="`${editorId}-todos-help`" :lang="langRef" :label="t('todos')" :text="t('contentTodosHelp')" /></div>
            <div class="content-mode-tool"><button class="mini content-reorder-toggle" type="button" :class="{ 'is-active': configMode }" :aria-pressed="configMode" :aria-describedby="`${editorId}-config-help`" @click="toggleConfigMode"><font-awesome-icon :icon="['fas', 'sliders']" aria-hidden="true" />{{ t('config') }}</button><InfoHint :id="`${editorId}-config-help`" :lang="langRef" :label="t('config')" :text="t('contentConfigHelp')" /></div>
          </div>
          <div class="panel-header-action content-mode-actions">
            <div class="content-mode-tool"><button class="mini content-reorder-toggle" type="button" :class="{ 'is-active': reorderMode && activeContentTab !== 'header' }" :aria-label="t('reorderSections')" :aria-pressed="reorderMode && activeContentTab !== 'header'" :aria-describedby="`${editorId}-reorder-help`" :disabled="activeContentTab === 'header'" @click="toggleReorderMode"><font-awesome-icon :icon="['fas', 'grip-vertical']" aria-hidden="true" />{{ t('reorder') }}</button><InfoHint :id="`${editorId}-reorder-help`" :lang="langRef" :label="t('reorderSections')" :text="t('contentReorderHelp')" /></div>
          </div>
        </div>
      </Teleport>
    </section>
  </form>
</template>

<style scoped>
.content-column { display: grid; gap: 0; min-width: 0; }
.content-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--ui-divider); }
.content-tab { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--muted); cursor: pointer; font: inherit; font-weight: 600; }
.content-tab:hover, .content-tab:focus-visible { background: var(--ui-surface-hover); color: var(--ui-text); }
.content-tab.active { border-bottom-color: var(--ui-accent-border); color: var(--ui-accent); }
.content-tab:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -3px; }
.content-tab__complete { color: #86efac; }
.content-tab-panel { min-width: 0; }
.letter-contact-fields { min-width: 0; margin: 16px 0 0; padding: 0; border: 0; }
.letter-contact-fields legend { padding: 0; color: var(--ui-text); font-size: .875rem; font-weight: 600; }
.letter-contact-fields__options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 12px; }
.letter-contact-fields__option { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 40px; color: var(--ui-text); cursor: pointer; }
.letter-contact-fields__option:hover { color: var(--ui-accent); }
.letter-contact-fields__option input { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--ui-accent); cursor: pointer; }
.letter-contact-fields__option input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
.content-panel { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.content-panel__scroll-body { display: grid; align-content: start; flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.content-reorder-toggle { display: inline-flex; align-items: center; gap: 6px; }
.content-mode-tool { display: flex; align-items: center; min-width: 0; gap: 2px; }
.content-mode-tool > .content-reorder-toggle { flex: 1; min-width: 0; }
.content-mode-toolbar { display: flex; flex: none; justify-content: center; flex-wrap: wrap; gap: 6px; margin-top: auto; padding: 10px; border-top: 1px solid #134e4a; border-radius: 0 0 6px 6px; background: #06141f; }
.content-mode-toolbar--docked { justify-content: flex-start; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
.content-mode-toolbar--docked .content-reorder-toggle { min-height: 40px; }
.content-mode-toolbar--sidebar { display: grid; grid-template-columns: minmax(0, 1fr); width: 100%; }
.content-mode-toolbar--sidebar .content-reorder-toggle { justify-content: flex-start; width: 100%; }
.content-mode-actions { display: contents; }
.content-reorder-toggle.is-active { color: var(--ui-accent); background: var(--ui-active); border-color: var(--ui-accent-border); }
.content-reorder-toggle:disabled { border-color: #18332e; background: #0b2520; color: #52736b; cursor: not-allowed; opacity: .65; }
.content-reorder-toggle:disabled:hover { background: #0b2520; }
.section-fields-control .svg-inline--fa { display: none; }
@media (max-width: 760px) {
  .content-mode-toolbar {
    order: -1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    margin: 0;
    padding: 0 0 8px;
    border: 0;
    border-bottom: 1px solid #134e4a;
    border-radius: 0;
    background: #06141f;
  }
  .content-mode-actions { display: contents; }
  .content-mode-toolbar.content-mode-toolbar--docked { order: initial; display: flex; width: 100%; padding: 0; border: 0; background: transparent; }
  .content-mode-toolbar--docked .content-mode-tool { flex: 1 0 112px; }
  .content-reorder-toggle { justify-content: center; gap: 6px; min-width: 0; min-height: 40px; padding: 6px 2px; font-size: 13px; }
  .content-reorder-toggle .svg-inline--fa { display: none; }
  .section-fields-control .svg-inline--fa { display: inline-block; }
  .section-fields-control span { display: none; }
}
.content-section-card { position: relative; min-width: 0; }
.section-drag-handle { position: absolute; top: 13px; left: 8px; z-index: 1; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; box-shadow: none; cursor: grab; touch-action: none; }
.section-drag-handle:focus-visible { outline: 2px solid #9be8c7; outline-offset: 2px; }
.is-reordering .content-section-card :deep(.section-head) { cursor: grab; }
.is-reordering .content-section-card :deep(.section-head):active, .section-drag-handle:active { cursor: grabbing; }
.is-reordering .content-section-card :deep(.section-head) { padding-left: 28px; }
.is-reordering .content-section-card :deep(.section-head > h3) { pointer-events: none; }
.is-reordering .content-section-card :deep(.section-head__actions), .is-reordering .content-section-card :deep(.visibility-toggle) { display: none; }
.uses-touch-reorder .section-drag-handle { width: 44px; height: 44px; color: var(--ui-accent); }
.is-reordering.uses-touch-reorder .content-section-card :deep(.section-head) { min-height: 52px; padding-left: 48px; cursor: default; touch-action: pan-y; }
.add-section-row { width: 100%; min-height: 54px; padding: 8px; border: 0; border-top: 1px dashed var(--ui-border); border-bottom: 1px dashed var(--ui-border); }
.about-editor { display: grid; gap: 4px; }
.sidebar-skill-row__content { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: end; }
.custom-body-entry__fields { display: grid; grid-template-columns: repeat(var(--custom-body-field-count), minmax(0, 1fr)); gap: 8px; }
.field-config-backdrop { position: fixed; inset: 0; width: 100%; max-width: none; height: 100%; max-height: none; margin: 0; padding: 16px; border: 0; background: transparent; color: var(--ui-text); color-scheme: dark; font-family: var(--font-ui); }
.field-config-backdrop[open] { display: grid; place-items: center; }
.field-config-backdrop::backdrop { background: rgba(2, 6, 23, .72); }
.field-config-dialog { display: grid; gap: 16px; width: min(100%, 560px); min-width: 0; max-height: 100%; overflow: auto; overscroll-behavior: contain; scrollbar-color: var(--ui-scrollbar) transparent; padding: 20px; border: 1px solid var(--ui-border); border-radius: 8px; background: var(--ui-control); box-shadow: 0 18px 48px rgba(0, 0, 0, .5); }
.field-config-dialog__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--ui-divider); }
.field-config-dialog__title { display: grid; gap: 4px; min-width: 0; overflow-wrap: break-word; }
.field-config-dialog__header h3 { margin: 0; color: var(--ui-text); font-size: 1rem; line-height: 1.5; }
.field-config-dialog p { margin: 0; color: var(--ui-muted); font-size: .875rem; line-height: 1.5; }
.field-config-dialog__close { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; }
.field-config-mode { min-width: 0; margin: 0; padding: 0; border: 0; }
.field-config-mode legend { margin-bottom: 8px; padding: 0; color: var(--ui-muted); font-size: .875rem; }
.field-config-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 4px 12px; }
.field-config-option { display: grid; grid-template-columns: 16px minmax(0, 1fr); align-items: center; gap: 12px; min-width: 0; min-height: 44px; padding: 8px 12px; border-radius: 6px; color: var(--ui-text); font-size: .875rem; line-height: 1.5; cursor: pointer; }
.field-config-option span { min-width: 0; overflow-wrap: break-word; }
.field-config-option:hover { background: var(--ui-surface-hover); }
.field-config-mode .field-config-option { border: 1px solid var(--ui-border); }
.field-config-mode .field-config-option:has(input:checked) { border-color: var(--ui-accent-border); background: var(--ui-active); }
/* Keep native choice controls independent of the full-width text-input styles. */
.field-config-option input { width: 16px; height: 16px; margin: 0; padding: 0; accent-color: var(--ui-accent); cursor: pointer; }
@media (max-width: 640px) { .sidebar-skill-row__content, .custom-body-entry__fields { grid-template-columns: 1fr; } }
@container cv-editor (max-width: 600px) {
  .custom-body-entry__fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container cv-editor (max-width: 440px) {
  .sidebar-skill-row__content, .custom-body-entry__fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
