import type { CvDesign, KeysOfType, SelectOption } from '../../../documents/cv/types';

export type StringDesignKey = KeysOfType<CvDesign, string>;
export interface FavoriteLink { linkKey: 'pageMarginVerticalLinked' | 'pageMarginHorizontalLinked' | 'headerBottomSpacingLinked'; primaryKey: StringDesignKey; secondaryKey: StringDesignKey }
export type DesignControl = {
  section: string; visible?: boolean; label: string; help?: string; options?: SelectOption[];
  min?: number; max?: number; step?: number; suffix?: string;
} & (
  | { type: 'toggle'; key: KeysOfType<CvDesign, boolean>; unit?: never; link?: never }
  | { type: 'select' | 'color'; key: StringDesignKey; unit?: never; link?: never }
  | ({ type: 'range'; min: number; max: number; step: number } & (
    | { key: StringDesignKey; unit: 'mm' | 'px' | 'pt' | 'fr'; link?: FavoriteLink }
    | { key: KeysOfType<CvDesign, number>; unit?: never; link?: never }
  ))
);
export type DesignControlRow = { type: 'single'; option: DesignControl } | { type: 'linked'; key: string; label: string; link: FavoriteLink; options: [DesignControl, DesignControl] };


/** Both the full editor and favorites use these same controls and linkage rules. */
export function designControlRows(options: DesignControl[], pairLabel: (key: FavoriteLink['linkKey']) => string): DesignControlRow[] {
  const byKey = new Map(options.map((option) => [option.key, option]));
  const handled = new Set<string>();
  return options.flatMap((option): DesignControlRow[] => {
    const link = option.link;
    if (!link || !byKey.has(link.primaryKey) || !byKey.has(link.secondaryKey)) return [{ type: 'single', option }];
    if (handled.has(link.linkKey)) return [];
    handled.add(link.linkKey);
    return [{ type: 'linked', key: link.linkKey, label: pairLabel(link.linkKey), link, options: [byKey.get(link.primaryKey)!, byKey.get(link.secondaryKey)!] }];
  });
}
