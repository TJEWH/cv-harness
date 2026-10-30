// Deferred sidebars use an absolutely positioned inner box. Keep the outer
// float as tall as that box, including any spacers added during pagination,
// so body blocks regain full width immediately below it without overlapping.
export function fitDeferredSidebarToContent(root: HTMLElement) {
  const sidebar = root.querySelector<HTMLElement>('#cv_side[data-pdf-deferred]');
  const content = sidebar?.querySelector('.sidebar-content');
  if (!content || !sidebar) return;
  sidebar.style.setProperty('--sidebar-deferred-min-height', '0px');
  const height = Math.max(0, content.getBoundingClientRect().bottom - sidebar.getBoundingClientRect().top);
  sidebar.style.height = `${height}px`;
}
