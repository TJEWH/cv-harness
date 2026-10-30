import assert from 'node:assert/strict';
import test from 'node:test';
import type { LetterContent } from '../src/documents/letter/letterTypes';
import { letterClosingSignature, letterParagraphGroups } from '../src/documents/letter/domain/letterLayout';
import { letterFromEditableText, letterToEditableText, resolveLetterContent } from '../src/documents/letter/motivationLetters';

const content = (body: string): LetterContent => ({ subject: '', salutation: '', body, closing: '' });

test('explicit letter fields preserve exact text and keep the opening together', () => {
  const letter: LetterContent = {
    subject: 'PhD application',
    salutation: 'Dear Professor Smith,',
    body: '  My first paragraph.\nA deliberate line break.\n\nMy research paragraph. ',
    closing: 'Yours sincerely,\n\nAlex Example',
  };
  const original = structuredClone(letter);
  assert.deepEqual(letterParagraphGroups(letter), [
    { kind: 'opening', paragraphs: [letter.salutation, '  My first paragraph.\nA deliberate line break.'] },
    { kind: 'body', paragraphs: ['My research paragraph. '] },
    { kind: 'closing', paragraphs: [letter.closing] },
  ]);
  assert.deepEqual(letter, original, 'rendering must not change persisted content');
});

test('an ordinary editor round trip retains salutation and signature grouping', () => {
  const letter: LetterContent = {
    subject: 'PhD application', salutation: 'Dear Selection Committee,',
    body: 'I am applying for the doctoral position.\n\nMy research experience matches the project.',
    closing: 'Yours faithfully,\n\nAlex Example\nMSc Computer Science',
  };
  const edited = letterFromEditableText(letterToEditableText(letter));
  const groups = letterParagraphGroups(edited);
  assert.deepEqual(groups, [
    { kind: 'opening', paragraphs: [letter.salutation, 'I am applying for the doctoral position.'] },
    { kind: 'body', paragraphs: ['My research experience matches the project.'] },
    { kind: 'closing', paragraphs: ['Yours faithfully,', 'Alex Example\nMSc Computer Science'] },
  ]);
  assert.equal(groups.flatMap((group) => group.paragraphs).join('\n\n'), edited.body);
});

test('German greeting after address and date keeps its first paragraph', () => {
  const paragraphs = ['Universität Beispiel\nFachbereich Informatik', 'Berlin, 11. Oktober 2026', 'Sehr geehrte Frau Prof. Beispiel,', 'Hiermit bewerbe ich mich um die Promotionsstelle.', 'Meine Forschung beschäftigt sich mit Robotik.', 'Mit freundlichen Grüßen', 'Alex Beispiel'];
  const groups = letterParagraphGroups(content(paragraphs.join('\n\n')));
  assert.deepEqual(groups.map((group) => group.kind), ['body', 'body', 'opening', 'body', 'closing']);
  assert.deepEqual(groups[2].paragraphs, paragraphs.slice(2, 4));
  assert.deepEqual(groups[4].paragraphs, paragraphs.slice(5));
  assert.deepEqual(groups.flatMap((group) => group.paragraphs), paragraphs);
});

test('single-newline greetings and sign-offs preserve existing line breaks', () => {
  const paragraphs = ['Dear Dr. Smith,\r\nI am applying for the doctoral position.', 'My research focuses on reliable systems.', 'Sincerely,\r\nAlex Example'];
  assert.deepEqual(letterParagraphGroups(content(paragraphs.join('\n\n'))), [
    { kind: 'opening', paragraphs: [paragraphs[0]] },
    { kind: 'body', paragraphs: [paragraphs[1]] },
    { kind: 'closing', paragraphs: [paragraphs[2]] },
  ]);
});

test('ordinary first paragraphs and sign-off words in sentences stay prose', () => {
  const paragraphs = ['My motivation is to pursue a PhD in robotics.', 'Dear colleagues have contributed to my research.', 'I sincerely appreciate your consideration.', 'Kind regards are a conventional way to close correspondence.'];
  assert.deepEqual(letterParagraphGroups(content(paragraphs.join('\n\n'))), paragraphs.map((paragraph) => ({ kind: 'body', paragraphs: [paragraph] })));
});

test('a sign-off followed by a substantial passage does not lock that passage', () => {
  const paragraphs = ['My opening paragraph.', 'Sincerely,', 'This is a substantial research discussion. '.repeat(20)];
  const groups = letterParagraphGroups(content(paragraphs.join('\n\n')));
  assert.deepEqual(groups.map((group) => group.kind), ['body', 'body', 'body']);
  assert.deepEqual(groups.flatMap((group) => group.paragraphs), paragraphs);
});

test('closing grouping does not pull the final research paragraph to a new page', () => {
  const paragraphs = ['My final research paragraph. '.repeat(30), 'With kind regards,', 'Alex Example'];
  const groups = letterParagraphGroups(content(paragraphs.join('\n\n')));
  assert.deepEqual(groups, [
    { kind: 'body', paragraphs: [paragraphs[0]] },
    { kind: 'closing', paragraphs: paragraphs.slice(1) },
  ]);
});

test('empty and incomplete letters render only supplied text', () => {
  assert.deepEqual(letterParagraphGroups(content(' \n\n ')), []);
  assert.deepEqual(letterParagraphGroups({ ...content(''), salutation: 'Dear Committee,', closing: 'Sincerely,\nAlex Example' }), [
    { kind: 'opening', paragraphs: ['Dear Committee,'] },
    { kind: 'closing', paragraphs: ['Sincerely,\nAlex Example'] },
  ]);
  assert.deepEqual(letterParagraphGroups(content('Dear Committee,\n\nSincerely,\n\nAlex Example')), [
    { kind: 'opening', paragraphs: ['Dear Committee,'] },
    { kind: 'closing', paragraphs: ['Sincerely,', 'Alex Example'] },
  ]);
});

test('signature line follows the sign-off and precedes an existing name and credentials', () => {
  const letter = { ...content('My research paragraph.'), closing: 'Yours sincerely,\n\nAlex Example\nMSc Computer Science\nExample University' };
  const before = structuredClone(letter);
  const group = letterParagraphGroups(letter).at(-1)!;
  const originalGroup = structuredClone(group);
  assert.deepEqual(letterClosingSignature(group, 'Different CV name'), {
    signOff: 'Yours sincerely,',
    signatureParagraphs: ['Alex Example\nMSc Computer Science\nExample University'],
  });
  assert.deepEqual(letter, before, 'signature layout must not rewrite stored letter content');
  assert.deepEqual(group, originalGroup, 'signature layout must not rewrite paragraph groups');
});

test('signature lines work after EN and DE closings folded into editable body text', () => {
  for (const closing of ['Yours faithfully,', 'Mit freundlichen Grüßen', 'Beste Gruesse']) {
    const letter = { ...content('My research paragraph.'), closing: `${closing}\n\nAlex Example\nMSc Computer Science\n\nExample University` };
    const edited = letterFromEditableText(letterToEditableText(letter));
    const groups = letterParagraphGroups(edited);
    assert.deepEqual(letterClosingSignature(groups.at(-1)!, 'Fallback name'), {
      signOff: closing,
      signatureParagraphs: ['Alex Example\nMSc Computer Science', 'Example University'],
    });
  }
});

test('a closing without a typed name uses the raw applicant name as a render-only fallback', () => {
  for (const letter of [
    { ...content('My research paragraph.'), closing: 'Sincerely,\r\n\r\n' },
    content('My research paragraph.\n\nMit freundlichen Grüßen'),
  ]) {
    const before = structuredClone(letter);
    const group = letterParagraphGroups(letter).at(-1)!;
    assert.deepEqual(letterClosingSignature(group, '  Alex Example  '), {
      signOff: letter.closing ? 'Sincerely,' : 'Mit freundlichen Grüßen', signatureParagraphs: ['Alex Example'],
    });
    assert.deepEqual(letter, before);
    assert.deepEqual(letterClosingSignature(group, ' ')!.signatureParagraphs, []);
  }
});

test('signature placeholders stay visible until normal identity resolution supplies the name', () => {
  for (const placeholder of ['{{APPLICANT_NAME}}', '[APPLICANT_NAME]', '[Your name]']) {
    const letter = { ...content('My research paragraph.'), closing: `Sincerely,\n${placeholder}` };
    assert.deepEqual(letterClosingSignature(letterParagraphGroups(letter).at(-1)!, 'Alex Example'), {
      signOff: 'Sincerely,', signatureParagraphs: [placeholder],
    });
  }
  const letter = { ...content('My research paragraph.'), closing: 'Sincerely,\n{{APPLICANT_NAME}}' };
  const resolved = resolveLetterContent(letter, { name: 'Alex Example', role: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '' });
  assert.deepEqual(letterClosingSignature(letterParagraphGroups(resolved).at(-1)!, 'Alex Example'), {
    signOff: 'Sincerely,', signatureParagraphs: ['Alex Example'],
  });
});

test('signature extraction preserves CRLF credentials and declines arbitrary or substantial prose', () => {
  assert.deepEqual(letterClosingSignature({ kind: 'closing', paragraphs: ['Sincerely,\r\nAlex Example\r\nMSc Computer Science'] }, 'Fallback name'), {
    signOff: 'Sincerely,', signatureParagraphs: ['Alex Example\r\nMSc Computer Science'],
  });
  for (const group of [
    { kind: 'body' as const, paragraphs: ['Sincerely,'] },
    { kind: 'opening' as const, paragraphs: ['Dear Committee,', 'My research paragraph.'] },
    { kind: 'closing' as const, paragraphs: [] },
    { kind: 'closing' as const, paragraphs: ['I look forward to discussing my research.'] },
    { kind: 'closing' as const, paragraphs: ['Sincerely,', 'This is a substantial research discussion. '.repeat(20)] },
  ]) assert.equal(letterClosingSignature(group, 'Alex Example'), null);
});
