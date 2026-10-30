import type { InjectionKey } from 'vue';
import type { FieldPrivacyType } from '../../cv/types';

export interface PrivacyEditorContext {
  language(): string;
  field(owner: object, field: string): { original: string | number; changed: boolean; automaticMask?: 'header' | FieldPrivacyType; reset(): void } | undefined;
  hiddenInContent(id: string): boolean;
  edited?(): void;
}

export const PRIVACY_EDITOR: InjectionKey<PrivacyEditorContext> = Symbol('privacy-editor');
