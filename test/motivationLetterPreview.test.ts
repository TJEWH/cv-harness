import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { createRenderer, defineComponent, h, nextTick, reactive, ref, toRaw, watch } from 'vue';
import type { Component, PropType } from 'vue';
import type { Contact } from '../src/documents/cv/types';
import type { LetterContent, LetterFormatting } from '../src/documents/letter/letterTypes';
import type { useDocumentPdfPreview } from '../src/documents/pdf/composables/useDocumentPdfPreview';
import { createSampleDocument } from '../src/features/cv-studio/domain/builtinConfigurations';

interface Node { tag: string; text: string; props: Record<string, unknown>; children: Node[]; parent: Node | null }
const node = (tag: string, text = ''): Node => ({ tag, text, props: {}, children: [], parent: null });
const renderer = createRenderer<Node, Node>({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child);
  },
  remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null; },
  setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
  patchProp(child, key, _old, value) { child.props[key] = value; }, parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
});
const find = (root: Node, predicate: (value: Node) => boolean): Node[] => [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => find(child, predicate))];
const text = (root: Node): string => root.tag === '#comment' ? '' : root.text + root.children.map(text).join('');
const hasClass = (element: Node, name: string) => String(element.props.class || '').split(/\s+/).includes(name);
const elements = (root: Node, name: string) => find(root, child => hasClass(child, name));
const letter = (overrides: Partial<LetterContent> = {}): LetterContent => ({
  subject: 'Application for a PhD in Computer Science', salutation: 'Dear Selection Committee,',
  body: 'My research addresses the reliability of interactive systems.', closing: 'Yours sincerely,', ...overrides,
});
type PreviewInput = Parameters<typeof useDocumentPdfPreview>[0];
const sourceUrl = new URL('../src/documents/letter/components/MotivationLetterPreview.vue', import.meta.url);
const compiled = compileScript(parse(readFileSync(sourceUrl, 'utf8')).descriptor, { id: 'MotivationLetterPreview.vue', inlineTemplate: true });
const source = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const require = createRequire(sourceUrl);

function mountPreview(initialContent = letter()) {
  let preview!: PreviewInput;
  const signatureVersions: string[] = [];
  const component: { default?: Component } = {};
  const Contact = defineComponent({
    props: { contact: { type: Object as PropType<Contact>, required: true } },
    setup(props) { return () => h('address', { class: 'contact', 'data-contact': props.contact }, Object.values(props.contact).filter(Boolean).join(' · ')); },
  });
  const replacements: Record<string, unknown> = {
    '../../cv/components/CvContact.vue': { default: Contact },
    '../../cv/composables/useCvDesign': { applyCvDesign() {} },
    '../../../shared/ui/useToasts': { useToastWatch() {} },
    '../../pdf/composables/useDocumentPdfPreview': {
      useDocumentPdfPreview(input: PreviewInput) {
        preview = input;
        watch(input.signature, value => { signatureVersions.push(JSON.stringify(value)); }, { deep: true, immediate: true, flush: 'sync' });
        return { pages: ref([]), page: ref(1), busy: ref(false), error: ref(''), getPdfBlob: async () => new Blob() };
      },
    },
  };
  new Function('require', 'exports', source)((name: string) => replacements[name] ?? (name.endsWith('.vue') ? { default: { render: () => null } } : require(name)), component);
  const state = reactive(createSampleDocument());
  state.contact = { name: 'Alex Example', role: 'Research Assistant', email: 'alex@example.edu', location: 'Berlin, Germany', phone: '+49 123 456', website: 'https://example.edu/alex', linkedin: 'https://linkedin.com/in/alex', github: 'https://github.com/alex' };
  state.disabled = [];
  const content = ref(initialContent);
  const formatting = ref<LetterFormatting>();
  const root = node('root');
  const app = renderer.createApp({ render: () => h(component.default!, { cvState: state, content: content.value, formatting: formatting.value, active: false }) });
  app.mount(root);
  return { state, content, formatting, root, preview, signatureVersions, unmount: () => app.unmount() };
}

test('letter header filters contact props while keeping the CV identity intact', async t => {
  const fixture = mountPreview();
  t.after(fixture.unmount);
  const originalContact = structuredClone({ ...fixture.state.contact });
  fixture.state.design.letterContactFields = ['name', 'email', 'website'];
  await nextTick();
  const header = find(fixture.root, child => child.tag === 'header')[0];
  assert.ok(header);
  assert.equal(elements(header, 'name')[0].text, 'Alex Example');
  assert.equal(elements(header, 'role').length, 0);
  const contact = elements(header, 'contact')[0].props['data-contact'];
  assert.deepEqual(contact, { name: 'Alex Example', role: '', location: '', email: 'alex@example.edu', phone: '', website: 'https://example.edu/alex', linkedin: '', github: '' });
  assert.doesNotMatch(text(header), /Research Assistant|Berlin|\+49|linkedin|github/);
  assert.deepEqual(fixture.state.contact, originalContact);
  fixture.state.design.letterContactFields = ['email'];
  await nextTick();
  assert.equal(elements(header, 'title').length, 0, 'contact-only headers do not retain an empty name column');
  assert.match(text(header), /alex@example.edu/);
});

test('an explicitly empty contact selection removes the sender and retains the subject in the header', async t => {
  const fixture = mountPreview();
  t.after(fixture.unmount);
  fixture.state.design.letterContactFields = [];
  await nextTick();
  const header = find(fixture.root, child => child.tag === 'header')[0];
  assert.ok(header);
  assert.equal(elements(header, 'title').length, 0);
  assert.equal(elements(header, 'contact').length, 0);
  assert.equal(hasClass(header, 'header'), false);
  assert.equal(elements(header, 'letter-subject')[0].text, fixture.content.value.subject);
  fixture.content.value.subject = '';
  await nextTick();
  assert.equal(find(fixture.root, child => child.tag === 'header').length, 0);
});

test('the closing signature uses the full applicant identity once when the header excludes the name', async t => {
  const fixture = mountPreview(letter({ closing: 'Yours sincerely,\n{{APPLICANT_NAME}}' }));
  t.after(fixture.unmount);
  fixture.state.design.letterContactFields = ['email'];
  await nextTick();
  const closing = elements(fixture.root, 'letter-group--closing');
  assert.equal(closing.length, 1);
  assert.equal(elements(closing[0], 'letter-signature-line').length, 1);
  assert.equal(elements(closing[0], 'letter-signature-name')[0].text, 'Alex Example');
  assert.equal(text(fixture.root).split('Alex Example').length - 1, 1);
  assert.equal(fixture.content.value.closing, 'Yours sincerely,\n{{APPLICANT_NAME}}', 'rendering never writes resolved identity into the stored letter');
  fixture.content.value.closing = 'Yours sincerely,';
  await nextTick();
  assert.equal(elements(fixture.root, 'letter-signature-name')[0].text, 'Alex Example', 'a sign-off alone receives the raw CV name');
  assert.equal(text(fixture.root).split('Alex Example').length - 1, 1);
});

for (const signOff of ['Yours faithfully,', 'Mit freundlichen Grüßen']) test(`${signOff} embedded in edited body receives a signature line before the existing name`, t => {
  const original = letter({ salutation: '', body: `Dear Selection Committee,\n\nMy research concerns reliable interfaces.\n\n${signOff}\n\nExisting Applicant\nMSc Computer Science`, closing: '' });
  const fixture = mountPreview(original);
  t.after(fixture.unmount);
  const closing = elements(fixture.root, 'letter-group--closing');
  assert.equal(closing.length, 1);
  const signOffNode = elements(closing[0], 'letter-paragraph')[0];
  const signatureLine = elements(closing[0], 'letter-signature-line')[0];
  const name = elements(closing[0], 'letter-signature-name')[0];
  assert.equal(signOffNode.text, signOff);
  assert.equal(name.text, 'Existing Applicant\nMSc Computer Science');
  assert.ok(closing[0].children.indexOf(signOffNode) < closing[0].children.indexOf(signatureLine));
  assert.ok(closing[0].children.indexOf(signatureLine) < closing[0].children.indexOf(name));
  assert.equal(elements(fixture.root, 'letter-signature-line').length, 1, 'recognized closings never receive a second fallback signature');
  assert.deepEqual(fixture.content.value, original);
});

test('formatting changes invalidate PDF input and update source geometry independently of CV margins', async t => {
  const fixture = mountPreview();
  t.after(fixture.unmount);
  fixture.state.design.pageMarginTop = '3mm';
  fixture.state.design.pageMarginLeft = '4mm';
  await nextTick();
  assert.deepEqual(fixture.preview.options().margin, [20, 20, 20, 20]);
  const before = fixture.signatureVersions.at(-1);
  fixture.formatting.value = { marginMm: 25, fontSizePt: 12, lineHeight: 1.5, headerNameSizePt: 22 };
  await nextTick();
  assert.notEqual(fixture.signatureVersions.at(-1), before, 'formatting is part of the reactive render signature');
  assert.deepEqual(fixture.preview.options().margin, [25, 25, 25, 25]);
  const article = find(fixture.root, child => child.tag === 'article')[0];
  assert.deepEqual(article.props.style, { '--letter-body-size': '12pt', '--letter-header-name-size': '22pt', '--letter-line-height': 1.5, width: '160mm', minHeight: '247mm' });
  const renderedSource = toRaw(await fixture.preview.source()) as unknown as Node;
  assert.ok(renderedSource === article, 'the renderer uses the same live source geometry');
  const custom = fixture.signatureVersions.at(-1);
  fixture.formatting.value.headerNameSizePt = 18;
  await nextTick();
  assert.notEqual(fixture.signatureVersions.at(-1), custom, 'nested formatting edits invalidate the PDF input');
  assert.equal((article.props.style as Record<string, unknown>)['--letter-header-name-size'], '18pt');
  fixture.formatting.value = undefined;
  await nextTick();
  assert.deepEqual(fixture.preview.options().margin, [20, 20, 20, 20]);
  assert.equal((article.props.style as Record<string, unknown>)['--letter-body-size'], '11pt');
  assert.equal((article.props.style as Record<string, unknown>)['--letter-line-height'], 1.2);
  assert.equal((article.props.style as Record<string, unknown>)['--letter-header-name-size'], '16pt');
  assert.equal(fixture.state.design.pageMarginTop, '3mm', 'letter formatting does not rewrite CV formatting');
});
