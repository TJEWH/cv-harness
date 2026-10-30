import type { LetterContent } from '../letterTypes';

export interface LetterParagraphGroup {
  kind: 'body' | 'opening' | 'closing';
  paragraphs: string[];
}

export interface LetterClosingSignature {
  signOff: string;
  signatureParagraphs: string[];
}

const greeting = /^(?:Dear|Sehr geehrte(?:r|s)?)\s+[^\r\n!?]{1,120}[,:]$/iu;
const signOff = /^(?:Yours sincerely|Yours faithfully|Sincerely(?: yours)?|(?:With )?(?:kind|best|sincere) regards|Regards|Respectfully(?: yours)?|Mit (?:freundlichen|besten) Gr(?:ü|ue)(?:ß|ss)en|Freundliche Gr(?:ü|ue)(?:ß|ss)e|Beste Gr(?:ü|ue)(?:ß|ss)e|Hochachtungsvoll),?$/iu;
const lines = (paragraph: string) => paragraph.trim().split(/\r?\n/);

function isGreeting(paragraph: string) {
  return greeting.test(lines(paragraph)[0]);
}

function isClosing(paragraphs: string[], index: number) {
  if (!signOff.test(lines(paragraphs[index])[0])) return false;
  const signature = [lines(paragraphs[index]).slice(1).join('\n'), ...paragraphs.slice(index + 1)].filter((part) => part.trim());
  // Allow a name, degree and affiliation on separate signature lines.
  // Keep longer passages in the body so pagination can split them.
  return signature.join(' ').length <= 300
    && signature.join(' ').trim().split(/\s+/).length <= 35
    && signature.every((part) => lines(part).length <= 3 && lines(part).every((line) => line.length <= 100));
}

/** Separate the closing to render a signature line between the sign-off and typed
 * signature. Preserve supplied names, credentials and placeholders; use the
 * applicant name only for an empty signature. Resolve identity placeholders from
 * the full CV contact first, regardless of the selected letter header fields. */
export function letterClosingSignature(group: LetterParagraphGroup, applicantName: string): LetterClosingSignature | null {
  if (group.kind !== 'closing' || !group.paragraphs.length || !isClosing(group.paragraphs, 0)) return null;
  const firstParagraph = group.paragraphs[0].trim();
  const boundary = firstParagraph.search(/\r?\n/);
  const signOffText = boundary < 0 ? firstParagraph : firstParagraph.slice(0, boundary);
  const signatureParagraphs = [
    boundary < 0 ? '' : firstParagraph.slice(boundary).trim(),
    ...group.paragraphs.slice(1),
  ].filter((paragraph) => paragraph.trim());
  if (!signatureParagraphs.length && applicantName.trim()) signatureParagraphs.push(applicantName.trim());
  return { signOff: signOffText, signatureParagraphs };
}

/** Group salutations and sign-offs for rendering without rewriting the edited body. */
export function letterParagraphGroups(content: LetterContent): LetterParagraphGroup[] {
  const paragraphs = content.body.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
  const groups: LetterParagraphGroup[] = [];
  let closing: string[] = content.closing.trim() ? [content.closing] : [];
  if (!closing.length) {
    for (let index = Math.max(0, paragraphs.length - 4); index < paragraphs.length; index++) {
      if (isClosing(paragraphs, index)) {
        closing = paragraphs.splice(index);
        break;
      }
    }
  }

  if (content.salutation.trim()) {
    groups.push({ kind: 'opening', paragraphs: [content.salutation, ...paragraphs.splice(0, 1)] });
  } else {
    // Address and date blocks can precede the greeting in an edited full letter.
    const openingIndex = paragraphs.slice(0, 4).findIndex(isGreeting);
    if (openingIndex >= 0) {
      groups.push(...paragraphs.splice(0, openingIndex).map((paragraph): LetterParagraphGroup => ({ kind: 'body', paragraphs: [paragraph] })));
      const opening = paragraphs.splice(0, 1);
      // Attach the next paragraph only when the greeting occupies its own paragraph.
      if (lines(opening[0]).length === 1) opening.push(...paragraphs.splice(0, 1));
      groups.push({ kind: 'opening', paragraphs: opening });
    }
  }

  groups.push(...paragraphs.map((paragraph): LetterParagraphGroup => ({ kind: 'body', paragraphs: [paragraph] })));
  if (closing.length) groups.push({ kind: 'closing', paragraphs: closing });
  return groups;
}
