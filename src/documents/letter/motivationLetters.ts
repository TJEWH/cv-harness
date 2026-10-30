import type { Application } from '../../app/cloudTypes';
import type { Contact, CvState } from '../cv/types';
import type { ApplicationLetter, LetterContent, LetterContextVersion, LetterFormatting, LetterRevision, LetterTemplate } from './letterTypes';
import { DEFAULT_LETTER_FORMATTING, LETTER_LAYOUT_VERSION, readLetterFormatting, resolveLetterFormatting } from './domain/letterFormatting';
import { letterTemplateWithSearchProfile, readLetterSearchProfile } from './searchLetterContext';

interface StorageAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const contentKeys = ['subject', 'salutation', 'body', 'closing'] as const;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const EMPTY_LETTER: LetterContent = { subject: '', salutation: '', body: '', closing: '' };
export const DEFAULT_TEMPLATE_GUIDANCE = {
  subjectInstructions: 'Write a concise subject naming the advertised position and any reference number from the opportunity. Do not invent a reference number.',
  salutationInstructions: 'Address the recipient named in the tender or opportunity using their stated title. If no suitable person is named, address the hiring or selection committee. Match the letter language and do not guess gender or titles.',
  closingInstructions: 'Close professionally in the letter language, express interest in a conversation and sign with {{APPLICANT_NAME}}.',
};
export const DEFAULT_QUESTION_GUIDANCE = 'When a required or beneficial qualification in the opportunity has no supporting CV evidence, ask whether I have relevant experience and request a concrete example only if the answer would improve the letter. Missing CV evidence does not mean I lack experience. If I do not have that experience, ask about a genuine learning interest only when useful; do not invent qualifications or imply that an unanswered question is evidence. Ask only unresolved, value-adding questions during drafting and refinement; do not repeat answered questions.';
export const LETTER_TEMPLATE_CONTEXT_MAX_LENGTH = 4000;
export const DEFAULT_REFINEMENT_SYSTEM_PROMPT = "For each motivation-letter refinement iteration, evaluate the latest saved answer to each resolved question against the letter's golden thread: the central narrative connecting my motivation, relevant experience and the opportunity. Include answer details only when they strengthen that narrative and add relevant, concrete value. Omit details that do not fit the golden thread, repeat existing points or add no value; resolving a question does not require including its answer in the letter. If an answer is too vague or unspecific to judge its relevance or value, ask a focused follow-up question that identifies the missing detail and explains why it matters. Keep that uncertain detail out of the letter until clarified. Preserve confirmed facts and my manual corrections, and keep questions in review annotations rather than in the motivation letter.";

export const DEFAULT_LETTER_TEMPLATES: LetterTemplate[] = [{
  id: 'research', name: 'Research application', revision: 5,
  ...DEFAULT_TEMPLATE_GUIDANCE,
  structure: [
    'Build a coherent research narrative around a golden thread: the question or problem I want to understand, the preparation I bring, and the research I could pursue in this position. Each paragraph should develop the preceding idea and give the next paragraph a reason to follow. Adapt the order and emphasis to the available evidence and word limit; use connected prose without section headings or a fixed paragraph count unless the application requires them.',
    'Begin with a focused research interest or unresolved problem from my stated interests and explain its relevance to the opportunity. Give the reader an intellectual direction to follow. Introduce the position through that connection, avoiding a generic application announcement or a life story.',
    'Develop that direction through the most relevant CV experience and confirmed answers. Choose the number and depth of examples by what they contribute: explore one experience in depth, or connect several brief experiences when they build a fuller picture. Explain my contribution, approach and what I learned or could not yet resolve where the context supports those details. Connect that preparation to the questions I now want to investigate. Avoid a CV recap, a list of tools or a quota of examples; do not invent an origin story or claim an experience caused an interest without evidence.',
    'Weave research fit into this progression. Explain the deeper intellectual connection between my interests and the project: what remains unresolved, why I care about understanding it, and why it could sustain my motivation over several years of research. Ground that motivation in my stated interests and confirmed context. Show how the actual project, methods or research environment would help me pursue it; avoid keyword matching, name-dropping and generic praise. If the motivation or connection is unclear, ask a focused question in the review annotations and keep the unconfirmed claim out of the letter.',
    'Conclude by bringing my personal research interests and the position context together into possible research directions. Develop a plausible question or approach from the preceding discussion and explain what my preparation would let me contribute. Present these as directions to explore and refine with the research team, allowing room for learning and changes in focus. Keep them grounded in the supplied interests and opportunity; do not invent project details, promise findings or impose a fixed dissertation plan. Let a brief invitation to discuss those directions follow the substantive conclusion.',
  ].join('\n\n'),
  tone: 'Write in a professional, thoughtful voice suited to a PhD application, with warmth, intellectual curiosity and quiet confidence. Convey intrinsic motivation through the questions I care about and why I want to keep investigating them. State my contributions and preparation plainly; show confidence through evidence and considered judgment. Be open about what I still need to learn, without self-deprecation, entitlement or claims of exceptional ability. Use direct language, concrete details, varied sentence lengths and natural transitions. Avoid generic AI phrasing, ceremonial enthusiasm, excessive flattery, buzzwords and formulaic contrasts. Do not rely on stock claims such as "I have always been passionate" or "I am the ideal candidate". Use only supplied facts and confirmed answers; do not invent experiences, feelings or motivations. Distinguish research interests and possible directions from established experience.',
  closingInstructions: 'End the substantive argument by connecting my stated research interests with the position in possible research directions, following the structure guidance. Add a brief invitation to discuss those directions if it fits, without repeating the conclusion. Use a professional sign-off in the letter language and sign with {{APPLICANT_NAME}}.',
  exampleText: '',
  researchInterests: '', useMetaSearchInterests: true, questionGuidance: DEFAULT_QUESTION_GUIDANCE, refinementSystemPrompt: DEFAULT_REFINEMENT_SYSTEM_PROMPT,
  language: 'en', maxWords: 450, updatedAt: '2026-10-29T00:00:00.000Z',
}, {
  id: 'industry', name: 'Industry application', revision: 4,
  ...DEFAULT_TEMPLATE_GUIDANCE,
  structure: [
    'Build a connected narrative around the work I want to do, the relevant experience I bring and the contribution I could make in this role. Let each paragraph develop the previous idea. Adapt the emphasis and paragraph count to the evidence and word limit; use flowing prose without section headings unless the application requires them.',
    'Open with a concrete connection between my stated motivation and the work or problem described in the opportunity. Develop it through selected CV evidence and confirmed answers. Explore one strong experience in depth or connect several shorter examples when they strengthen the same argument; there is no required number of examples. Explain my contribution and supported outcomes, and connect them to the work ahead. Avoid listing skills or retelling the CV.',
    'Explain why this work and organization matter to me using the supplied context. Conclude by connecting that motivation and preparation to a plausible contribution or direction in the role, followed by a brief invitation to discuss. Distinguish possible contributions from promised outcomes, and keep unsupported motivations or qualifications out of the letter.',
  ].join('\n\n'),
  tone: 'Clear, concise and confident. Avoid generic claims and invented qualifications.',
  exampleText: '',
  researchInterests: '', useMetaSearchInterests: true, questionGuidance: DEFAULT_QUESTION_GUIDANCE, refinementSystemPrompt: DEFAULT_REFINEMENT_SYSTEM_PROMPT,
  language: 'en', maxWords: 350, updatedAt: '2026-10-29T00:00:00.000Z',
}];

// Upgrade only exact former defaults in built-in templates, preserving each customized field.
const LEGACY_TEMPLATE_GUIDANCE: Record<string, { structure: string; tones: string[] }> = {
  research: {
    structure: 'Opening: identify the opportunity and research interest.\nEvidence: connect two relevant experiences from the CV to the requirements.\nResearch fit: explain a specific connection to the project.\nClosing: state the contribution and interest in a discussion.',
    tones: [
      'Specific, thoughtful and professional. Use only facts present in the context; do not invent experience.',
      'Thoughtful, precise and personal, with natural transitions and varied sentence lengths. Make motivation credible through concrete questions and reflection on evidence. Avoid stock enthusiasm, inflated claims and repetitive summaries. Use only supplied facts and confirmed answers; distinguish research interests and possible directions from established experience.',
    ],
  },
  industry: {
    structure: 'Opening: role and motivation.\nRelevant evidence: two examples of skills and outcomes from the CV.\nContribution: connect experience to the organization and role.\nClosing: concise invitation to discuss.',
    tones: ['Clear, concise and confident. Avoid generic claims and invented qualifications.'],
  },
};

function readContent(value: unknown): LetterContent {
  if (!isObject(value) || contentKeys.some((key) => typeof value[key] !== 'string')) throw new Error('Invalid letter content.');
  return Object.fromEntries(contentKeys.map((key) => [key, value[key]])) as unknown as LetterContent;
}

function readVersion(value: unknown): LetterContextVersion {
  if (!isObject(value) || typeof value.content !== 'string' || typeof value.theme !== 'string') throw new Error('Invalid letter context.');
  return { content: value.content, theme: value.theme };
}

export function readLetterTemplate(value: unknown): LetterTemplate {
  if (!isObject(value) || ['id', 'name', 'structure', 'tone', 'language', 'updatedAt'].some((key) => typeof value[key] !== 'string')
    || !String(value.id).trim() || !String(value.name).trim() || !Number.isInteger(value.revision) || Number(value.revision) < 1
    || !Number.isInteger(value.maxWords) || Number(value.maxWords) < 50 || Number(value.maxWords) > 2000) throw new Error('Invalid letter template.');
  const guidance = { ...DEFAULT_TEMPLATE_GUIDANCE };
  for (const key of Object.keys(guidance) as (keyof typeof guidance)[]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || value[key].length > 1000) throw new Error('Template instructions must contain at most 1000 characters each.');
    guidance[key] = value[key];
  }
  if (value.exampleText !== undefined && (typeof value.exampleText !== 'string' || value.exampleText.length > 20000)) {
    throw new Error('The example letter must contain at most 20000 characters.');
  }
  // Frozen snapshots retain their guidance; built-in upgrades happen only in the live library.
  const formatting = value.formatting === undefined ? undefined : readLetterFormatting(value.formatting);
  if (value.useMetaSearchInterests !== undefined && typeof value.useMetaSearchInterests !== 'boolean') throw new Error('The meta-search research-interest preference must be a checkbox value.');
  const context: Pick<LetterTemplate, 'researchInterests' | 'questionGuidance' | 'refinementSystemPrompt'> = {};
  for (const key of ['researchInterests', 'questionGuidance', 'refinementSystemPrompt'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || value[key].length > LETTER_TEMPLATE_CONTEXT_MAX_LENGTH) {
      throw new Error(`Research interests, question guidance and the refinement system prompt must contain at most ${LETTER_TEMPLATE_CONTEXT_MAX_LENGTH} characters each.`);
    }
    context[key] = value[key];
  }
  return { ...guidance, ...context, ...(value.useMetaSearchInterests !== undefined ? { useMetaSearchInterests: value.useMetaSearchInterests } : {}), ...(formatting ? { formatting } : {}), id: String(value.id), name: String(value.name), revision: Number(value.revision), structure: String(value.structure),
    tone: String(value.tone), exampleText: (value.exampleText as string | undefined) ?? '', language: String(value.language), maxWords: Number(value.maxWords), updatedAt: String(value.updatedAt) };
}

function readRecord(value: unknown, userId: string, applicationId: string): ApplicationLetter {
  if (!isObject(value) || value.version !== 1 || value.userId !== userId || value.applicationId !== applicationId
    || typeof value.templateId !== 'string' || typeof value.instructions !== 'string' || typeof value.language !== 'string'
    || !Number.isInteger(value.maxWords) || Number(value.maxWords) < 50 || Number(value.maxWords) > 2000 || typeof value.updatedAt !== 'string'
    || !(value.finalRevisionId === null || typeof value.finalRevisionId === 'string') || !Array.isArray(value.revisions)) throw new Error('Stored letter could not be read. Restore its local backup before editing.');
  const revisions = value.revisions.map((item): LetterRevision => {
    if (!isObject(item) || typeof item.id !== 'string' || !['generated', 'edited', 'final'].includes(String(item.kind)) || typeof item.createdAt !== 'string') throw new Error('Invalid letter revision.');
    return { id: item.id, kind: item.kind as LetterRevision['kind'], content: readContent(item.content), context: readVersion(item.context),
      createdAt: item.createdAt, ...(typeof item.cloudDraftId === 'string' ? { cloudDraftId: item.cloudDraftId } : {}),
      ...(typeof item.cloudContextId === 'string' ? { cloudContextId: item.cloudContextId } : {}) };
  });
  const templateSnapshot = value.templateSnapshot === undefined ? undefined : readLetterTemplate(value.templateSnapshot);
  const searchProfile = value.searchProfile === undefined ? undefined : readLetterSearchProfile(value.searchProfile);
  if (templateSnapshot && searchProfile) letterTemplateWithSearchProfile(templateSnapshot, searchProfile);
  const formatting = value.formatting === undefined ? undefined : readLetterFormatting(value.formatting);
  if (templateSnapshot && templateSnapshot.id !== value.templateId) throw new Error('The saved letter template does not match its snapshot.');
  return { version: 1, applicationId, userId, templateId: value.templateId, ...(templateSnapshot ? { templateSnapshot } : {}), ...(searchProfile ? { searchProfile } : {}), instructions: value.instructions, language: value.language,
    maxWords: Number(value.maxWords), working: readContent(value.working), workingContext: readVersion(value.workingContext), ...(formatting ? { formatting } : {}),
    publishedContexts: isObject(value.publishedContexts) ? Object.fromEntries(Object.entries(value.publishedContexts).map(([key, version]) => [key, readVersion(version)])) : {},
    finalRevisionId: value.finalRevisionId, revisions, updatedAt: value.updatedAt };
}

export function createLetterRepository(storage: StorageAdapter, userId: string) {
  const scope = `cv.letters.v1:${encodeURIComponent(userId || 'local')}`;
  const templatesKey = `${scope}:templates`;
  const applicationKey = (id: string) => `${scope}:application:${encodeURIComponent(id)}`;
  function listTemplates(): LetterTemplate[] {
    const raw = storage.getItem(templatesKey);
    if (!raw) return clone(DEFAULT_LETTER_TEMPLATES);
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Stored templates could not be read.');
    let upgraded = false;
    const templates = data.map(readLetterTemplate).map((template) => {
      const legacy = LEGACY_TEMPLATE_GUIDANCE[template.id];
      const current = DEFAULT_LETTER_TEMPLATES.find((item) => item.id === template.id);
      const upgradeSource = template.useMetaSearchInterests === undefined;
      const upgradeStructure = !!legacy && !!current && template.structure === legacy.structure;
      const upgradeTone = !!legacy && !!current && template.tone !== current.tone && legacy.tones.includes(template.tone);
      if (!upgradeStructure && !upgradeTone && !upgradeSource) return template;
      upgraded = true;
      return { ...template, ...(upgradeSource ? { useMetaSearchInterests: true } : {}), structure: upgradeStructure ? current!.structure : template.structure,
        tone: upgradeTone ? current!.tone : template.tone,
        closingInstructions: upgradeStructure && template.closingInstructions === DEFAULT_TEMPLATE_GUIDANCE.closingInstructions ? current!.closingInstructions : template.closingInstructions,
        revision: Math.max(template.revision + 1, current?.revision || 1), updatedAt: now() };
    });
    if (upgraded) storage.setItem(templatesKey, JSON.stringify(templates));
    return templates;
  }
  function pinLegacyTemplate(record: ApplicationLetter) {
    if (record.templateSnapshot) return record;
    const template = listTemplates().find((item) => item.id === record.templateId);
    if (!template) return record;
    // This compatibility upgrade must not change wording, settings or review history.
    const snapshot = clone(template);
    delete snapshot.useMetaSearchInterests;
    const pinned = { ...record, templateSnapshot: snapshot };
    storage.setItem(applicationKey(record.applicationId), JSON.stringify(pinned));
    return pinned;
  }
  return {
    listTemplates,
    defaultTemplate() {
      const templates = listTemplates();
      const preferredId = storage.getItem(`${scope}:default-template`) || DEFAULT_LETTER_TEMPLATES[0]!.id;
      return templates.find(item => item.id === preferredId) || templates[0] || null;
    },
    setDefaultTemplate(id: string) {
      if (!listTemplates().some(item => item.id === id)) throw new Error('Save the letter template before making it the default.');
      storage.setItem(`${scope}:default-template`, id);
    },
    saveTemplate(input: LetterTemplate, baseline?: LetterTemplate | null) {
      let template = readLetterTemplate(input);
      const templates = listTemplates();
      const previous = templates.find((item) => item.id === template.id);
      if (baseline) {
        const original = readLetterTemplate(baseline);
        if (original.id !== template.id) throw new Error('The template does not match the editor’s saved version.');
        if (!previous) throw new Error('This template is no longer saved. Your edits are still in the editor.');
        // An editor can outlive writes from another tab. Apply only its actual
        // changes, so an untouched blank field cannot erase newer saved context.
        const merged: Record<string, unknown> = { ...previous };
        for (const key of Object.keys({ ...original, ...template }) as (keyof LetterTemplate)[]) {
          if (key === 'id' || key === 'revision' || key === 'updatedAt') continue;
          const before = JSON.stringify(original[key]);
          const incoming = JSON.stringify(template[key]);
          const current = JSON.stringify(previous[key]);
          if (incoming === before) continue;
          if (current !== before && current !== incoming) {
            throw new Error('This template has conflicting changes in another tab. Your edits are still here. Copy them before reloading to review the latest saved version.');
          }
          merged[key] = template[key];
        }
        template = readLetterTemplate(merged);
      }
      const saved = { ...template, revision: previous ? previous.revision + 1 : 1, updatedAt: now() };
      storage.setItem(templatesKey, JSON.stringify([...templates.filter((item) => item.id !== saved.id), saved]));
      return clone(saved);
    },
    importTemplates(json: string) {
      const parsed: unknown = JSON.parse(json);
      if (!isObject(parsed) || parsed.format !== 'cv-letter-templates' || parsed.version !== 1 || !Array.isArray(parsed.templates)) throw new Error('Choose a letter template library exported by this app.');
      const incoming = parsed.templates.map(readLetterTemplate);
      const templates = listTemplates();
      // Imported libraries are copied, so existing template choices and revisions stay stable.
      const copies = incoming.map((item) => ({ ...item, id: crypto.randomUUID(), revision: 1, updatedAt: now() }));
      storage.setItem(templatesKey, JSON.stringify([...templates, ...copies]));
      return copies;
    },
    exportTemplates() { return JSON.stringify({ format: 'cv-letter-templates', version: 1, templates: listTemplates() }, null, 2); },
    load(applicationId: string) {
      const raw = storage.getItem(applicationKey(applicationId));
      return raw ? pinLegacyTemplate(readRecord(JSON.parse(raw), userId, applicationId)) : null;
    },
    save(record: ApplicationLetter) {
      const validated = readRecord(record, userId, record.applicationId);
      storage.setItem(applicationKey(record.applicationId), JSON.stringify(validated));
      return clone(validated);
    },
    exportLetter(applicationId: string) {
      const raw = storage.getItem(applicationKey(applicationId));
      if (!raw) throw new Error('There is no saved letter to export.');
      return raw;
    },
    importLetter(json: string, applicationId: string) {
      const record = pinLegacyTemplate(readRecord(JSON.parse(json), userId, applicationId));
      storage.setItem(applicationKey(applicationId), JSON.stringify(record));
      return clone(record);
    },
  };
}

/** Stable local revision identity; never uploaded. */
function fingerprint(value: unknown) {
  function stable(input: unknown): string {
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    if (isObject(input)) return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stable(input[key])}`).join(',')}}`;
    return JSON.stringify(input) ?? 'null';
  }
  let hash = 2166136261;
  for (const char of stable(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}

/** JSONB may reorder object keys while preserving identical research/content. */
export function sameLetterContextInput(left: unknown, right: unknown) { return fingerprint(left) === fingerprint(right); }

export function letterContextVersion(application: Pick<Application, 'context_json' | 'cv_variant_id'>, state: CvState | null, template: LetterTemplate, language: string, instructions: string, maxWords: number, formatting?: LetterFormatting): LetterContextVersion {
  const { design, completedSections: _completed, keepTogetherSections: _together, sectionHeaderSizes: _sizes, ...content } = state || {};
  // Absent optional fields and their empty defaults describe the same legacy context.
  const { exampleText, researchInterests, useMetaSearchInterests: _sourcePreference, questionGuidance, refinementSystemPrompt, formatting: templateFormatting, ...guidance } = template;
  const templateContext = { ...guidance, ...(exampleText ? { exampleText } : {}),
    ...(researchInterests ? { researchInterests } : {}), ...(questionGuidance ? { questionGuidance } : {}),
    ...(refinementSystemPrompt ? { refinementSystemPrompt } : {}) };
  const { headerNameSizePt, ...baseFormatting } = resolveLetterFormatting(formatting, templateFormatting);
  // The original fixed 16 pt name must keep existing layout fingerprints valid.
  const layoutFormatting = { ...baseFormatting, ...(headerNameSizePt === DEFAULT_LETTER_FORMATTING.headerNameSizePt ? {} : { headerNameSizePt }) };
  return { content: fingerprint({ opportunity: application.context_json, cv: content, template: templateContext, language, instructions, maxWords }),
    theme: fingerprint({ design: design || {}, letterLayout: LETTER_LAYOUT_VERSION, formatting: layoutFormatting }) };
}

export function createApplicationLetter(userId: string, applicationId: string, template: LetterTemplate, context: LetterContextVersion, lang = template.language): ApplicationLetter {
  return { version: 1, userId, applicationId, templateId: template.id, templateSnapshot: readLetterTemplate(template), instructions: '', language: lang, maxWords: template.maxWords,
    working: { ...EMPTY_LETTER }, workingContext: clone(context), publishedContexts: {}, revisions: [], finalRevisionId: null, updatedAt: now() };
}

/** Explicit replacement pins a new template while preserving the application letter. */
export function selectApplicationLetterTemplate(record: ApplicationLetter, template: LetterTemplate): ApplicationLetter {
  const snapshot = readLetterTemplate(template);
  return { ...clone(record), templateId: snapshot.id, templateSnapshot: snapshot, language: snapshot.language,
    maxWords: snapshot.maxWords, finalRevisionId: null, updatedAt: now() };
}

export function contextChanges(record: ApplicationLetter, context: LetterContextVersion) {
  return { content: record.workingContext.content !== context.content, theme: record.workingContext.theme !== context.theme };
}

/** A final pointer alone never authorizes an export of different working text. */
export function finalizedLetterRevision(record: ApplicationLetter): LetterRevision | null {
  const revision = record.revisions.find((item) => item.id === record.finalRevisionId && item.kind === 'final');
  if (!revision || JSON.stringify(revision.content) !== JSON.stringify(record.working)
    || revision.context.content !== record.workingContext.content || revision.context.theme !== record.workingContext.theme) return null;
  return revision;
}

export function editLetter(record: ApplicationLetter, content: LetterContent) {
  if (JSON.stringify(content) === JSON.stringify(record.working)) return clone(record);
  return { ...clone(record), working: readContent(content), finalRevisionId: null, updatedAt: now() };
}

/** Formatting changes need a fresh layout approval while preserving the writing history. */
export function formatLetter(record: ApplicationLetter, formatting?: LetterFormatting): ApplicationLetter {
  const templateFormatting = record.templateSnapshot?.formatting;
  const resolved = resolveLetterFormatting(formatting, templateFormatting);
  const changed = JSON.stringify(resolved) !== JSON.stringify(resolveLetterFormatting(record.formatting, templateFormatting));
  const copy = clone(record);
  if (formatting === undefined) delete copy.formatting;
  else copy.formatting = readLetterFormatting(formatting);
  if (changed) { copy.finalRevisionId = null; copy.updatedAt = now(); }
  return copy;
}

/** One editable document, retaining a simple subject heading and every existing text block. */
export function letterToEditableText(content: LetterContent): string {
  return [content.subject ? `# ${content.subject}` : '', content.salutation, content.body, content.closing].filter((part) => part.length > 0).join('\n\n');
}

/** After editing, salutation and closing are ordinary parts of the complete body. */
export function letterFromEditableText(text: string): LetterContent {
  const unchanged = { ...EMPTY_LETTER, body: text };
  const firstLine = /^(?:[\t \uFEFF]*\r?\n)*[\t \uFEFF]*([^\r\n]+)(?:\r?\n(?:[\t ]*\r?\n)?|$)/u.exec(text);
  if (!firstLine) return unchanged;
  const line = firstLine[1].trim();
  const heading = /^#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?$/u.exec(line);
  const unwrap = (value: string) => value.trim().replace(/^(\*\*|__|\*|_)(.+)\1$/u, '$2').trim();
  const title = unwrap(heading?.[1] || line);
  const labelText = title.replace(/^(\*\*|__|\*|_)((?:Subject|Betreff|Re)[\t ]*:?)\1[\t ]*/iu, '$2 ');
  const labelled = /^(?:Subject|Betreff|Re)[\t ]*:[\t ]*(.*)$/iu.exec(labelText);
  const subject = unwrap(labelled ? labelled[1] : title);
  if (!subject) return unchanged;
  const body = text.slice(firstLine[0].length);
  // An unmarked first line is a subject only when the next content is a formal
  // salutation. Never promote an ordinary opening paragraph into the header.
  const greeting = /^(?:Dear|Sehr geehrte(?:r|s)?)\s+[^\r\n!?]{1,120}[,:](?:\r?\n|$)/iu;
  const plainSubject = subject.length <= 300 && !greeting.test(line) && greeting.test(body.trimStart());
  if (!heading && !labelled && !plainSubject) return unchanged;
  return { ...EMPTY_LETTER, subject, body };
}

export function addIncomingDraft(record: ApplicationLetter, content: LetterContent, context: LetterContextVersion, metadata: { cloudDraftId?: string; cloudContextId?: string } = {}) {
  if (metadata.cloudDraftId && record.revisions.some((item) => item.cloudDraftId === metadata.cloudDraftId)) return clone(record);
  const revision: LetterRevision = { id: crypto.randomUUID(), kind: 'generated', content: readContent(content), context: clone(context), createdAt: now(), ...metadata };
  return { ...clone(record), revisions: [...clone(record.revisions), revision], updatedAt: now() };
}

export function saveWorkingRevision(record: ApplicationLetter) {
  const revision: LetterRevision = { id: crypto.randomUUID(), kind: 'edited', content: clone(record.working), context: clone(record.workingContext), createdAt: now() };
  return { ...clone(record), revisions: [...clone(record.revisions), revision], updatedAt: now() };
}

/** Explicitly opening a draft archives current edits and never removes a final revision. */
export function openLetterRevision(record: ApplicationLetter, revisionId: string) {
  const source = record.revisions.find((item) => item.id === revisionId);
  if (!source) throw new Error('Letter revision is unavailable.');
  const copy = clone(record);
  if (Object.values(copy.working).some((value) => value.trim())) copy.revisions.push({ id: crypto.randomUUID(), kind: 'edited', content: clone(copy.working), context: clone(copy.workingContext), createdAt: now() });
  copy.working = clone(source.content);
  copy.workingContext = clone(source.context);
  copy.finalRevisionId = source.kind === 'final' ? source.id : null;
  copy.updatedAt = now();
  return copy;
}

export function finalizeLetter(record: ApplicationLetter, context: LetterContextVersion, contact: Contact | null) {
  if (!record.working.body.trim()) throw new Error('Write or import the letter before finalizing it.');
  if (unresolvedLetterPlaceholders(record.working, contact).length) throw new Error('Resolve all placeholders before finalizing the letter.');
  const revision: LetterRevision = { id: crypto.randomUUID(), kind: 'final', content: clone(record.working), context: clone(context), createdAt: now() };
  return { ...clone(record), workingContext: clone(context), finalRevisionId: revision.id, revisions: [...clone(record.revisions), revision], updatedAt: now() };
}

const identityFields: Record<string, keyof Contact> = { NAME: 'name', EMAIL: 'email', PHONE: 'phone', LOCATION: 'location', ROLE: 'role', WEBSITE: 'website', LINKEDIN: 'linkedin', GITHUB: 'github' };
const placeholderPattern = /\{\{\s*([^{}]+?)\s*\}\}|\[([A-Z][A-Z_]+)\]/g;
export function resolveLetterText(text: string, contact: Contact | null) {
  return text.replace(placeholderPattern, (token, braces: string | undefined, brackets: string | undefined) => {
    const key = (braces || brackets || '').trim().toUpperCase().replace(/^(APPLICANT|CANDIDATE|CONTACT)[._]/, '');
    const field = identityFields[key];
    return field && contact?.[field] ? contact[field] : token;
  });
}
export function resolveLetterContent(content: LetterContent, contact: Contact | null): LetterContent {
  return Object.fromEntries(contentKeys.map((key) => [key, resolveLetterText(content[key], contact)])) as unknown as LetterContent;
}
export function unresolvedLetterPlaceholders(content: LetterContent, contact: Contact | null) {
  return [...new Set(Object.values(resolveLetterContent(content, contact)).flatMap((value) => [...value.matchAll(placeholderPattern)].map((match) => match[0])))];
}

export function parseIncomingLetter(text: string): LetterContent {
  const trimmed = text.trim().replace(/^```(?:json)?\s*\n?|\n?```$/g, '');
  if (trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isObject(parsed) || typeof parsed.body !== 'string') throw new Error('Draft JSON needs a body field.');
    return readContent({ ...EMPTY_LETTER, ...parsed });
  }
  return letterFromEditableText(text.trim());
}
