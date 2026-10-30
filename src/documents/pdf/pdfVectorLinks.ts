import type { LinkCapture, Surface, PageSlice } from './pdfTypes';
import { safeLinkUrl } from '../../shared/lib/safeUrl';
// Capture link rectangles in the same final clone that supplies the painter.
// Previews and downloads share these clickable areas.
export function capturePdfLinks(root: HTMLElement): LinkCapture {
  const bounds = root.getBoundingClientRect();
  return {
    width: Math.ceil(bounds.width),
    height: Math.ceil(bounds.height),
    fontStyleUrls: Array.from(root.ownerDocument?.querySelectorAll<HTMLLinkElement>('link[id^="cv-font-"]') || [], (link) => link.href),
    loadedFaces: root.ownerDocument?.fonts ? Array.from(root.ownerDocument.fonts, (face) => ({
      family: face.family, style: face.style, weight: face.weight, unicodeRange: face.unicodeRange, status: face.status,
    })) : undefined,
    links: Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((anchor) => {
      const href = safeLinkUrl(anchor.href);
      if (!href) return [];
      return Array.from(anchor.getClientRects(), (rect) => ({
        href,
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height,
      })).filter((rect) => rect.width > 0 && rect.height > 0);
    }),
  };
}

export function vectorPageLinks(capture: LinkCapture | undefined, canvas: Surface, page: PageSlice) {
  if (!capture?.width || !capture.height) return [];
  const scaleX = canvas.width / capture.width;
  const scaleY = canvas.height / capture.height;
  const millimetersPerPixel = page.contentWidth / page.canvasWidth;
  return capture.links.flatMap((link) => {
    const href = safeLinkUrl(link.href);
    if (!href) return [];
    const top = Math.max(link.y * scaleY, page.sourceTop);
    const bottom = Math.min((link.y + link.height) * scaleY, page.sourceBottom);
    const left = Math.max(0, link.x * scaleX);
    const right = Math.min(canvas.width, (link.x + link.width) * scaleX);
    if (bottom <= top || right <= left) return [];
    return [{
      href,
      x: page.leftOffset + left * millimetersPerPixel,
      y: page.topOffset + (top - page.sourceTop) * millimetersPerPixel,
      width: (right - left) * millimetersPerPixel,
      height: (bottom - top) * millimetersPerPixel,
    }];
  });
}
