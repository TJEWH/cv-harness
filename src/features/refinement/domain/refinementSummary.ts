import type { RefinementProposal } from '../refinementTypes';

/** Counts describe the returned proposal, independently of later review decisions. */
export function refinementSummaryCounts(proposal: RefinementProposal, document: 'cv' | 'letter') {
  const annotations = (proposal.annotations || []).filter(annotation => annotation.document === document);
  return {
    automaticChanges: document === 'cv' ? proposal.cvOperations.length : 0,
    todos: annotations.filter(annotation => annotation.type === 'todo').length,
    questions: annotations.filter(annotation => annotation.type === 'question').length,
  };
}

/** Older one-sentence summaries stay intact; displaying them must not invent draft content. */
export function conciseLetterSummary(summary: string, lang = 'en'): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  const sentences = new Intl.Segmenter(lang === 'de' ? 'de' : 'en', { granularity: 'sentence' }).segment(normalized);
  const concise = Array.from(sentences, sentence => sentence.segment.trim())
    .flatMap(sentence => sentence.split(/(?<=[.!?])\s+(?=\d)/u)).slice(0, 2).join(' ');
  if (concise.length <= 400) return concise;
  const prefix = concise.slice(0, 399).replace(/[\uD800-\uDBFF]$/, '');
  const wordBoundary = prefix.lastIndexOf(' ');
  return (wordBoundary > 0 ? prefix.slice(0, wordBoundary) : prefix).trimEnd() + '…';
}
