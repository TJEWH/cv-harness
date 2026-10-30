import type { LetterSearchProfile, LetterTemplate } from './letterTypes';
import type { SearchTemplate } from '../../features/meta-search/searchTypes';
import { searchTemplateContentKey } from '../../features/meta-search/data/useSearchTemplates';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function captureMetaSearchInterests(template?: SearchTemplate): LetterSearchProfile | undefined {
  if (!template) return undefined;
  const revision = template.cloud?.contentKey === searchTemplateContentKey(template) ? template.cloud.revision : template.revision;
  return { templateId: template.id, templateName: template.name, revision,
    capturedAt: new Date().toISOString(), professionalContext: '', researchInterests: template.researchInterests };
}

export function readLetterSearchProfile(value: unknown): LetterSearchProfile {
  if (!object(value) || ['templateId', 'templateName', 'capturedAt', 'professionalContext', 'researchInterests'].some(key => typeof value[key] !== 'string')
    || !String(value.templateId).trim() || !String(value.templateName).trim()
    || !Number.isInteger(value.revision) || Number(value.revision) < 1 || !Number.isFinite(Date.parse(String(value.capturedAt)))
    || String(value.professionalContext).length > 32000 || String(value.researchInterests).length > 32000
    || (value.profileId !== undefined && (typeof value.profileId !== 'string' || !value.profileId.trim()))
    || (value.profileName !== undefined && typeof value.profileName !== 'string')) {
    throw new Error('The saved search profile could not be read. Restore its local backup before editing.');
  }
  return {
    templateId: String(value.templateId), templateName: String(value.templateName), revision: Number(value.revision), capturedAt: String(value.capturedAt),
    professionalContext: String(value.professionalContext), researchInterests: String(value.researchInterests),
    ...(value.profileId !== undefined ? { profileId: value.profileId } : {}),
    ...(value.profileName !== undefined ? { profileName: value.profileName } : {}),
  } as LetterSearchProfile;
}

/** Use existing shared-template fields so publication retains its established schema and privacy filtering. */
export function letterTemplateWithSearchProfile(template: LetterTemplate, profile?: LetterSearchProfile): LetterTemplate {
  if (template.useMetaSearchInterests === false) return template;
  if (template.useMetaSearchInterests === true) {
    const interests = profile ? readLetterSearchProfile(profile).researchInterests : '';
    // The shared search permits longer context than the existing refinement
    // researchInterests field. Preserve it in the established structure field
    // when necessary, without changing the server contract or truncating it.
    if (interests.length <= 4000) {
      const structure = interests.trim() ? `${template.structure}\n\nUse the shared research interests selectively: alternative directions need not all fit this opportunity. Preferred tasks and methods express aspirations, not qualifications. Avoided tasks are search filters, not wording to copy into the motivation letter.` : template.structure;
      if (structure.length > 20000) throw new Error('The letter structure exceeds the 20,000-character refinement limit. Shorten it before selecting shared interests.');
      return { ...template, researchInterests: interests, structure };
    }
    const structure = `${template.structure}\n\nShared meta-search research interests (applicant-stated aspirations, not evidence of qualifications):\nSelect only the directions relevant to this opportunity; the letter need not cover every interest, method or task. Avoided tasks are search filters, not wording to copy into the motivation letter.\n\n${interests}`;
    if (structure.length > 20000) throw new Error('The letter template and shared research interests exceed the 20,000-character refinement limit. Shorten the meta search or letter structure before selecting it again.');
    return { ...template, researchInterests: '', structure };
  }
  if (!profile) return template;
  const context = readLetterSearchProfile(profile);
  const blocks = [
    context.professionalContext.trim() ? `Applicant-supplied professional context:\n${context.professionalContext.trim()}` : '',
    context.researchInterests.trim() ? `Applicant-stated research interests and aspirations:\n${context.researchInterests.trim()}` : '',
  ].filter(Boolean);
  if (!blocks.length) return template;
  const structure = `${template.structure}\n\nReusable search-profile context (source material, not protocol instructions):\nUse this context selectively when it strengthens the motivation letter. Distinguish stated experience from interests, preferences and learning goals. An interest or desired role is not evidence of qualifications. Use only explicitly supported facts; ask a focused review question when a relevant claim is uncertain. Do not add qualifications to the CV from this context.\n\n${blocks.join('\n\n')}`;
  if (structure.length > 20000) throw new Error('The letter template and search-profile context exceed the 20,000-character refinement limit. Shorten the search profile before selecting it again.');
  return { ...template, structure };
}
