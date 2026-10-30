import type { OpportunityContextGroup, OpportunityContextGroupId, OpportunityContextNode } from './opportunityContext';
import { isOpportunityInternalFact } from './opportunityPresentation';
import { livingStandardNode } from './livingStandard';
import { safeEmailUrl, safeWebUrl } from '../../../shared/lib/safeUrl';

type Row = Record<string, unknown>;
interface PresentationHelpers {
  label: (key: string) => string;
  checklistKey: (value: unknown, path: string) => string;
}
const row = (value: unknown): Row | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.flatMap(value => row(value) ? [value as Row] : []) : [];
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.flatMap(value => text(value) ? [text(value)!] : []))] : [];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identity = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();

/** Canonical records are presented through named fields, never a traversal of their storage keys. */
export function buildCanonicalOpportunityGroups(context: Row, lang: string, helpers: PresentationHelpers): OpportunityContextGroup[] {
  const de = lang === 'de';
  const tr = (en: string, german: string) => de ? german : en;
  const data = row(context.data) ?? {};
  const groups: OpportunityContextGroup[] = [
    ['overview', tr('Research overview & fit', 'Forschungsüberblick & Passung')],
    ['requirements', tr('Requirements', 'Anforderungen')],
    ['documents', tr('Application documents', 'Bewerbungsunterlagen')],
    ['salary', tr('Salary & funding', 'Gehalt & Finanzierung')],
    ['advisor', tr('Advisor & lab context', 'Betreuung & Forschungsgruppe')],
    ['links', tr('Sources & contacts', 'Quellen & Kontakte')],
  ].map(([id, label]) => ({ id: id as OpportunityContextGroupId, label, items: [] }));
  const group = (id: OpportunityContextGroupId) => groups.find(group => group.id === id)!.items;
  const leaf = (id: string, label: string | null, value: unknown): OpportunityContextNode | undefined => text(value) ? { id, label, text: text(value) } : undefined;
  const compact = (nodes: (OpportunityContextNode | undefined)[]) => nodes.filter((node): node is OpportunityContextNode => !!node);
  const number = (value: number) => new Intl.NumberFormat(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 2 }).format(value);

  const sources = new Map<string, { label: string; supports: Set<string> }>();
  const assignedSources = new Set<string>();
  const supportTargets = new Map<string, Set<OpportunityContextNode>>();
  const supportKey = (path: string) => path.replace(/^\//u, '');
  const pointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
  function target(node: OpportunityContextNode, ...paths: string[]) {
    for (const path of paths) {
      const key = supportKey(path), targets = supportTargets.get(key) ?? new Set<OpportunityContextNode>();
      targets.add(node); supportTargets.set(key, targets);
    }
    return node;
  }
  function source(url: unknown, original?: Row) {
    const href = typeof url === 'string' ? safeWebUrl(url) : null;
    if (!href) return;
    if (!sources.has(href)) {
      const parsed = new URL(href);
      sources.set(href, { label: `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`, supports: new Set<string>() });
    }
    for (const path of strings(original?.supports)) sources.get(href)!.supports.add(supportKey(path));
    return { href, ...sources.get(href)! };
  }
  for (const value of rows(context.sources)) source(value.url, value);
  for (const key of ['official_url', 'source_url', 'application_url']) source(context[key]);
  function evidence(value: unknown) {
    const entries = new Map<string, { text: string; href: string }>();
    for (const url of strings(value)) {
      const entry = source(url);
      if (entry) { assignedSources.add(entry.href); entries.set(entry.href, { text: entry.label, href: entry.href }); }
    }
    return [...entries.values()];
  }
  function attachEvidence(node: OpportunityContextNode, value: unknown) {
    node.evidence = [...new Map([...(node.evidence ?? []), ...evidence(value)].map(entry => [entry.href, entry])).values()];
  }
  function facts(value: unknown, id: string, parentLabel?: string, path = id.slice('root.'.length).replaceAll('.', '/')): OpportunityContextNode[] {
    const seen = new Map<string, OpportunityContextNode>();
    return rows(value).flatMap((fact, index) => {
      const label = text(fact.label), body = text(fact.text);
      if (!label || !body || isOpportunityInternalFact(fact)) return [];
      const signature = `${identity(label)}:${body.replace(/\s+/gu, ' ')}`;
      const previous = seen.get(signature);
      if (previous) { attachEvidence(previous, fact.source_urls); target(previous, `${path}/${index}`); return []; }
      const repeatsParent = parentLabel && [parentLabel, id.split('.').at(-1)!.replaceAll('_', ' ')].some(parent => identity(label) === identity(parent));
      const node = target({ id: `${id}.${index}`, label: repeatsParent ? null : label, text: body, evidence: evidence(fact.source_urls) }, path, `${path}/${index}`);
      seen.set(signature, node); return [node];
    });
  }
  const list = (id: string, label: string, value: unknown): OpportunityContextNode | undefined => {
    const values = strings(value);
    return values.length ? { id, label, text: values.join(' · ') } : undefined;
  };
  const addFacts = (destination: OpportunityContextNode[], value: unknown, id: string, label: string, path?: string) => {
    const values = facts(value, id, label, path);
    if (values.length === 1 && !values[0]!.label) { values[0]!.label = label; destination.push(values[0]!); }
    else if (values.length) destination.push({ id, label, children: values });
  };

  const overview = group('overview');
  const summary = leaf('root.research_summary', helpers.label('research_summary'), context.research_summary);
  if (summary) overview.push(target({ ...summary, kind: 'summary' }, 'research_summary'));
  const location = leaf('root.location', tr('Location', 'Ort'), [text(context.city), text(context.country)].filter(Boolean).join(', '));
  if (location) overview.push(target(location, 'city', 'country'));
  const primaryKey = ['official_url', 'application_url', 'source_url'].find(key => typeof context[key] === 'string' && safeWebUrl(context[key] as string));
  const primary = primaryKey ? source(context[primaryKey]) : undefined;
  if (primary) { assignedSources.add(primary.href); overview.push({ id: 'root.primary_link', label: helpers.label(primaryKey!), text: primaryKey === 'application_url' ? tr('Open portal', 'Portal öffnen') : primaryKey === 'source_url' ? tr('Open source', 'Quelle öffnen') : tr('Open listing', 'Ausschreibung öffnen'), href: primary.href, kind: 'main-link' }); }
  for (const key of ['personal_fit', 'research_career_potential', 'rd_career_potential']) {
    const value = row(context[key]);
    if (!value) continue;
    const score = finite(value.score) && value.score >= 0 && value.score <= 10 ? value.score : undefined;
    const children = compact([
      leaf(`root.${key}.summary`, null, value.summary),
      list(`root.${key}.gaps`, tr('Gaps', 'Lücken'), value.gaps),
      ...facts(value.notes, `root.${key}.notes`),
    ]);
    if (score !== undefined || children.length) overview.push(target({ id: `root.${key}`, label: helpers.label(key), kind: 'fit', score,
      ...(score !== undefined ? { text: `${number(score)} / 10` } : {}), children }, key));
  }
  const balance = row(context.hardware_software_balance);
  if (balance) {
    const children = compact([
      leaf('root.hardware_software_balance.classification', null, balance.classification),
      leaf('root.hardware_software_balance.summary', null, balance.summary),
      leaf('root.hardware_software_balance.details', null, balance.details),
      list('root.hardware_software_balance.hardware', tr('Hardware', 'Hardware'), balance.hardware),
      list('root.hardware_software_balance.software', tr('Software', 'Software'), balance.software),
      ...facts(balance.notes, 'root.hardware_software_balance.notes'),
    ]);
    if (children.length) overview.push(target({ id: 'root.hardware_software_balance', label: helpers.label('hardware_software_balance'), children }, 'hardware_software_balance'));
  }
  for (const [key, label, value] of [
    ['topics', helpers.label('topics'), context.topics], ['research_methods', tr('Methods', 'Methoden'), data.research_methods],
    ['open_questions', helpers.label('open_questions'), context.open_questions],
  ] as const) {
    const node = list(`root.${key}`, label, value); if (node) overview.push(target(node, key === 'research_methods' ? 'data/research_methods' : key));
  }
  const teaching = row(data.teaching_load);
  if (teaching) {
    const detail = leaf('root.teaching_load', tr('Teaching', 'Lehre'), teaching.details);
    if (detail) overview.push(target(detail, 'data/teaching_load', 'data/teaching_load/details'));
    addFacts(overview, teaching.notes, 'root.teaching_load.notes', tr('Teaching', 'Lehre'), 'data/teaching_load/notes');
  }
  addFacts(overview, data.notes, 'root.data.notes', tr('Notes', 'Notizen'));

  for (const [key, destination] of [['requirements', 'requirements'], ['required_documents', 'documents']] as const) {
    for (const [index, item] of rows(context[key]).entries()) {
      const name = text(item.text); if (!name) continue;
      const id = `root.${key}.${index}`;
      const status = item.status === 'advantageous' ? 'beneficial' : item.status;
      const statuses = ['required', 'optional', 'conditional', 'beneficial', 'preferred', 'recommended', 'desired', 'unspecified'];
      const limits = [finite(item.max_pages) ? `${number(item.max_pages)} ${tr('pages maximum', 'Seiten maximal')}` : '',
        finite(item.max_words) ? `${number(item.max_words)} ${tr('words maximum', 'Wörter maximal')}` : ''].filter(Boolean).join(' · ');
      group(destination).push(target({ id, label: name, kind: 'requirement',
        checklistKey: helpers.checklistKey(item, `${destination}:${key}`),
        requirementStatus: statuses.includes(String(status)) ? status as OpportunityContextNode['requirementStatus'] : 'unspecified',
        requirementStage: typeof item.stage === 'string' ? helpers.label(item.stage) : undefined,
        children: compact([
          ...strings(item.conditions).map((condition, index) => leaf(`${id}.conditions.${index}`, null, condition)),
          leaf(`${id}.limits`, null, limits), list(`${id}.formats`, tr('File formats', 'Dateiformate'), item.file_formats),
          ...facts(item.notes, `${id}.notes`),
        ]), evidence: evidence(item.source_urls),
      }, key, `${key}/${index}`, ...(text(item.entity_id) ? [`${key}/@${pointer(text(item.entity_id)!)}`] : [])));
    }
  }
  const process = facts(data.application_process, 'root.application_process', undefined, 'data/application_process');
  if (process.length) group('documents').push({ id: 'root.application_process', label: tr('Application process', 'Bewerbungsablauf'), kind: 'prose', children: process });

  const salary = group('salary');
  if (data.living_standard !== undefined) salary.push(target(livingStandardNode(data.living_standard, lang), 'data/living_standard'));
  const periods: Record<string, string> = { hour: tr('hour', 'Stunde'), day: tr('day', 'Tag'), week: tr('week', 'Woche'), month: tr('month', 'Monat'), year: tr('year', 'Jahr'), contract: tr('contract', 'Vertrag') };
  function money(value: Row): string | undefined {
    const amount = finite(value.amount) ? number(value.amount)
      : finite(value.min) && finite(value.max) ? value.min === value.max ? number(value.min) : `${number(value.min)}–${number(value.max)}`
        : finite(value.min) ? `${tr('from', 'ab')} ${number(value.min)}` : finite(value.max) ? `${tr('up to', 'bis')} ${number(value.max)}` : '';
    if (!amount) return;
    return [amount, text(value.currency), text(value.period) && periods[String(value.period)] ? `/ ${periods[String(value.period)]}` : '',
      typeof value.gross === 'boolean' ? tr(value.gross ? 'gross' : 'net', value.gross ? 'brutto' : 'netto') : ''].filter(Boolean).join(' ') || undefined;
  }
  const pay = row(context.salary);
  if (pay) {
    const children = compact([
      leaf('root.salary.model', null, pay.model), leaf('root.salary.details', null, pay.details),
      ...rows(pay.components).map((component, index): OpportunityContextNode | undefined => {
        const amount = money(component), notes = facts(component.notes, `root.salary.components.${index}.notes`);
        const children = compact([leaf(`root.salary.components.${index}.condition`, null, component.condition), ...notes]);
        return amount || children.length || text(component.model) ? target({ id: `root.salary.components.${index}`, label: text(component.label) ?? null,
          text: [amount, text(component.model)].filter(Boolean).join(' · ') || undefined, children, evidence: evidence(component.source_urls) }, `salary/components/${index}`) : undefined;
      }), ...facts(pay.notes, 'root.salary.notes'),
    ]);
    if (money(pay) || children.length) salary.push(target({ id: 'root.salary', label: helpers.label('salary'), text: money(pay), children, evidence: evidence(pay.source_urls) }, 'salary'));
  }
  addFacts(salary, data.funding, 'root.funding', helpers.label('funding'), 'data/funding');
  const duration = [finite(context.duration_months) ? `${number(context.duration_months)} ${tr('months', 'Monate')}` : '', text(context.duration_details)].filter(Boolean).join(' · ');
  const durationNode = leaf('root.duration', tr('Contract duration', 'Vertragsdauer'), duration); if (durationNode) salary.push(target(durationNode, 'duration_months', 'duration_details'));
  const start = leaf('root.start_date', helpers.label('start_date'), context.start_date); if (start) salary.push(target(start, 'start_date'));
  addFacts(salary, data.start_details, 'root.start_details', tr('Start', 'Beginn'), 'data/start_details');

  type Person = { aliases: Set<string>; fields: Row[]; profiles: Row[]; advisor: boolean };
  const people: Person[] = [];
  const aliases = (value: Row) => [
    ['id', value.entity_id], ['id', value.researcher_id], ['orcid', value.orcid], ['email', value.email], ['name', value.name],
  ].flatMap(([kind, value]) => text(value) ? [`${kind}:${identity(text(value)!)}`] : []);
  const refersTo = (person: Person, reference: string) => ['id', 'name', 'orcid', 'email'].some(kind => person.aliases.has(`${kind}:${identity(reference)}`));
  function addPerson(value: Row, advisor: boolean, profile = false) {
    const keys = aliases(value); if (!keys.length) return;
    let matches = people.filter(person => keys.some(key => !key.startsWith('name:') && person.aliases.has(key)));
    if (!matches.length && text(value.name)) {
      const byName = people.filter(person => person.aliases.has(`name:${identity(text(value.name)!)}`)
        && (!text(value.institution) || person.fields.every(field => !text(field.institution) || identity(text(field.institution)!) === identity(text(value.institution)!))));
      if (byName.length === 1) matches = byName;
    }
    const person = matches[0] ?? { aliases: new Set<string>(), fields: [], profiles: [], advisor };
    if (!matches.length) people.push(person);
    for (const merged of matches.slice(1)) {
      merged.aliases.forEach(key => person.aliases.add(key)); person.fields.push(...merged.fields); person.profiles.push(...merged.profiles); person.advisor ||= merged.advisor;
      people.splice(people.indexOf(merged), 1);
    }
    keys.forEach(key => person.aliases.add(key)); person.advisor ||= advisor;
    (profile ? person.profiles : person.fields).push(value);
  }
  rows(context.contacts).forEach(value => addPerson(value, false));
  rows(context.supervisors).forEach(value => addPerson(value, true));
  const focus = row(context.supervisor_research_focus) ?? {};
  rows(focus.profiles).forEach(value => addPerson(value, true, true));
  const papers = rows(context.supervisor_top_papers);
  const usedPapers = new Set<Row>();
  function paper(value: Row, id: string): OpportunityContextNode | undefined {
    const doi = text(value.doi);
    const href = typeof value.url === 'string' ? safeWebUrl(value.url) : doi && /^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f]+$/u.test(doi) ? safeWebUrl(`https://doi.org/${encodeURIComponent(doi).replace(/%2F/gu, '/')}`) : null;
    const title = text(value.title) ?? doi ?? (href ? tr('Publication', 'Publikation') : undefined); if (!title) return;
    const details = [finite(value.year) ? String(value.year) : '', text(value.venue), strings(value.authors).join(', ')].filter(Boolean).join(' · ');
    if (href) assignedSources.add(href);
    return target({ id, label: title, ...(href ? { href, text: tr('Open publication', 'Publikation öffnen') } : {}),
      children: compact([leaf(`${id}.details`, null, details), leaf(`${id}.relevance`, tr('Relevance to the opportunity', 'Bezug zur Stelle'), value.relevance),
        leaf(`${id}.selection_basis`, tr('Selection', 'Auswahl'), value.selection_basis), ...facts(value.notes, `${id}.notes`)]), evidence: evidence(value.source_urls) },
      'supervisor_top_papers', `supervisor_top_papers/${papers.indexOf(value)}`,
      ...(text(value.entity_id) ? [`supervisor_top_papers/@${pointer(text(value.entity_id)!)}`] : []));
  }
  for (const [index, person] of people.entries()) {
    const id = `root.people.${index}`, all = [...person.fields, ...person.profiles];
    const firstText = (key: string) => all.map(value => text(value[key])).find(Boolean);
    const name = firstText('name') ?? tr('Research contact', 'Forschungskontakt');
    const roles = [...new Set(person.fields.flatMap(value => strings(value.roles)))];
    const children = compact([
      leaf(`${id}.roles`, null, roles.join(' · ')),
      ...person.fields.flatMap((value, index) => compact([
        text(value.institution) && value.institution !== context.institution ? leaf(`${id}.institution.${index}`, null, value.institution) : undefined,
        text(value.orcid) && /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/u.test(String(value.orcid))
          ? { id: `${id}.orcid.${index}`, label: null, text: `ORCID ${text(value.orcid)}`, href: `https://orcid.org/${text(value.orcid)}` } : undefined,
      ])),
      ...person.fields.flatMap((value, index) => {
        const email = safeEmailUrl(typeof value.email === 'string' ? value.email : '');
        return compact([email ? { id: `${id}.email.${index}`, label: null, text: text(value.email), href: email } : undefined,
          leaf(`${id}.phone.${index}`, null, value.phone), ...facts(value.notes, `${id}.notes.${index}`)]);
      }),
      ...person.profiles.flatMap((profile, index) => compact([
        leaf(`${id}.focus.${index}`, null, profile.summary), list(`${id}.topics.${index}`, helpers.label('topics'), profile.topics),
        list(`${id}.methods.${index}`, tr('Methods', 'Methoden'), profile.methods), ...facts(profile.notes, `${id}.focus.notes.${index}`),
      ])),
    ]);
    const matchedPapers = papers.filter(value => strings(value.supervisors).some(reference => refersTo(person, reference))
      && people.filter(candidate => strings(value.supervisors).some(reference => refersTo(candidate, reference))).length === 1);
    const paperNodes = compact(matchedPapers.map((value, index) => paper(value, `${id}.papers.${index}`)));
    if (paperNodes.length) { children.push({ id: `${id}.papers`, label: helpers.label('supervisor_top_papers'), children: paperNodes }); matchedPapers.forEach(value => usedPapers.add(value)); }
    const unique: OpportunityContextNode[] = [];
    for (const node of children) {
      const existing = unique.find(value => value.label === node.label && value.text === node.text && value.href === node.href && JSON.stringify(value.children) === JSON.stringify(node.children));
      if (!existing) unique.push(node);
      else {
        existing.evidence = [...new Map([...(existing.evidence ?? []), ...(node.evidence ?? [])].map(source => [source.href, source])).values()];
        for (const targets of supportTargets.values()) if (targets.delete(node)) targets.add(existing);
      }
    }
    const refs = [...new Set(all.flatMap(value => strings(value.source_urls)))];
    const personNode = { id, label: name, kind: 'person' as const, children: unique, evidence: evidence(refs) };
    for (const key of ['contacts', 'supervisors'] as const) rows(context[key]).forEach((value, index) => {
      if (person.fields.includes(value)) target(personNode, key, `${key}/${index}`, ...(text(value.entity_id) ? [`${key}/@${pointer(text(value.entity_id)!)}`] : []));
    });
    rows(focus.profiles).forEach((value, index) => {
      if (person.profiles.includes(value)) target(personNode, 'supervisor_research_focus', `supervisor_research_focus/profiles/${index}`);
    });
    group(person.advisor ? 'advisor' : 'links').push(personNode);
  }
  const unassignedPapers = compact(papers.filter(value => !usedPapers.has(value)).map((value, index) => paper(value, `root.papers.${index}`)));
  if (unassignedPapers.length) group('advisor').push({ id: 'root.papers', label: helpers.label('supervisor_top_papers'), children: unassignedPapers });
  addFacts(group('advisor'), focus.notes, 'root.focus.notes', tr('Research focus', 'Forschungsschwerpunkt'), 'supervisor_research_focus/notes');
  const unit = leaf('root.unit', helpers.label('unit'), context.unit); if (unit) group('advisor').push(target(unit, 'unit'));
  addFacts(group('advisor'), data.research_context, 'root.research_context', helpers.label('research_context'), 'data/research_context');
  const background = row(context.supervisor_reputation);
  if (background) {
    const children = compact([leaf('root.supervisor_reputation.summary', null, background.summary), list('root.supervisor_reputation.evidence', tr('Evidence', 'Belege'), background.evidence),
      list('root.supervisor_reputation.limitations', tr('Limitations', 'Einschränkungen'), background.limitations), ...facts(background.notes, 'root.supervisor_reputation.notes')]);
    if (children.length) group('advisor').push(target({ id: 'root.supervisor_reputation', label: helpers.label('supervisor_reputation'), children, evidence: evidence(background.source_urls) }, 'supervisor_reputation'));
  }

  const application = source(context.application_url);
  if (application && application.href !== primary?.href) {
    assignedSources.add(application.href);
    group('links').push({ id: 'root.application_url', label: helpers.label('application_url'), href: application.href, text: tr('Open application portal', 'Bewerbungsportal öffnen') });
  }
  const vacancy = leaf('root.vacancy_id', helpers.label('vacancy_id'), context.vacancy_id); if (vacancy) group('links').push(target(vacancy, 'vacancy_id'));
  addFacts(group('links'), data.provenance, 'root.provenance', tr('Source notes', 'Quellenhinweise'), 'data/provenance');
  for (const [href, entry] of sources) for (const path of entry.supports) {
    const targets = supportTargets.get(path);
    if (targets?.size === 1) attachEvidence([...targets][0]!, [href]);
  }
  const unassigned = [...sources.keys()].filter(href => !assignedSources.has(href));
  if (unassigned.length) group('links').push({ id: 'root.sources', label: tr('Sources', 'Quellen'), evidence: evidence(unassigned) });
  return groups.filter(group => group.items.length);
}
