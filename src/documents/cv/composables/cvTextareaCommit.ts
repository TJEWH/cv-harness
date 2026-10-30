import type { InjectionKey } from 'vue';

// Markdown editors commit through their owning CV/section/privacy persistence
// layer after the shared textarea has released its local draft.
export const CV_TEXTAREA_COMMIT: InjectionKey<() => void> = Symbol('cv-textarea-commit');
