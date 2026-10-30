// Compile-only regressions: removing a contract must make an expect-error fail.
import type { ItemField } from '../src/documents/cv/types';
import type SectionList from '../src/features/cv-studio/components/SectionList.vue';
import type BackupManager from '../src/features/cv-studio/components/BackupManager.vue';
import type FormBuilder from '../src/features/cv-studio/components/FormBuilder.vue';
import type PdfPagination from '../src/documents/pdf/components/PdfPagination.vue';

export function checkFieldContracts(accept: (field: ItemField) => void) {
  accept({ key: 'title', type: 'text', label: 'Title' });
  accept({ key: 'levelValue', type: 'number', label: 'Level' });
  // @ts-expect-error Numeric controls cannot write to text fields.
  accept({ key: 'title', type: 'number', label: 'Title' });
  // @ts-expect-error Text controls cannot overwrite a restricted state value.
  accept({ key: 'state', type: 'text', label: 'State' });
  // @ts-expect-error State options must contain valid ItemState values.
  accept({ key: 'state', type: 'select', label: 'State', options: [{ label: 'Invalid', value: 'obsolete' }] });
}

export function checkEventContracts(
  list: InstanceType<typeof SectionList>, backup: InstanceType<typeof BackupManager>,
  builder: InstanceType<typeof FormBuilder>, pagination: InstanceType<typeof PdfPagination>,
) {
  list.$emit('update:modelValue', [{ id: 'item' }]);
  backup.$emit('save-result', true);
  builder.$emit('section-save-status', 'saved');
  pagination.$emit('update:page', 2);
  // @ts-expect-error Model updates require CV items.
  list.$emit('update:modelValue', ['invalid']);
  // @ts-expect-error Save results are booleans.
  backup.$emit('save-result', 'saved');
  // @ts-expect-error Save status has a closed set of values.
  builder.$emit('section-save-status', 'invalid');
  // @ts-expect-error Page updates require a number.
  pagination.$emit('update:page', '2');
}
