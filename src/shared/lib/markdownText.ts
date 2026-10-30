import { safeWebUrl } from './safeUrl';

export type InlineToken = { type: 'text' | 'bold'; value: string } | { type: 'link'; value: string; href: string };

export function normalizeMarkdownText(value: string | undefined) {
  return (value ?? '').replaceAll('\r\n', '\n');
}

export function parseMarkdownText(value: string | undefined) {
  const proseLines: string[] = [];
  const bullets: string[] = [];
  let listStarted = false;
  let currentBullet = -1;

  normalizeMarkdownText(value).split('\n').forEach((line) => {
    const bullet = line.match(/^\s*-(?:\s+(.*)|\s*)$/);

    if (bullet) {
      listStarted = true;
      bullets.push(bullet[1] || '');
      currentBullet = bullets.length - 1;
      return;
    }

    if (!listStarted) {
      proseLines.push(line);
      return;
    }

    if (line.trim() && currentBullet !== -1) {
      bullets[currentBullet] = `${bullets[currentBullet]}${bullets[currentBullet] ? '\n' : ''}${line.trim()}`;
    }
  });

  return {
    prose: proseLines.join('\n').trim(),
    bullets: bullets.filter((item) => item.trim()),
  };
}

export const safeMarkdownUrl = safeWebUrl;

export function parseInlineMarkdown(value: unknown) {
  const source = String(value ?? '');
  const tokens: InlineToken[] = [];
  const pattern = /\*\*([\s\S]+?)\*\*|\[([^\]]+)\]\(([^\s)]+)\)/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(source))) {
    if (match.index > cursor) tokens.push({ type: 'text', value: source.slice(cursor, match.index) });

    if (match[1] != null) {
      tokens.push({ type: 'bold', value: match[1] });
    } else {
      const label = match[2];
      const href = safeMarkdownUrl(match[3]);
      if (href) tokens.push({ type: 'link', value: label, href });
      else tokens.push({ type: 'text', value: match[0] });
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < source.length) tokens.push({ type: 'text', value: source.slice(cursor) });
  return tokens;
}

export function hasMarkdownText(value: string | undefined) {
  const { prose, bullets } = parseMarkdownText(value);
  return Boolean(prose || bullets.length);
}
