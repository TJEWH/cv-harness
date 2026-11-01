import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadBrowserRuntime() {
  try { return await import('playwright'); }
  catch (cause) {
    const target = process.env.PLAYWRIGHT_MODULE_PATH;
    if (!target) throw new Error('Browser tests require an installed Playwright runtime. Set PLAYWRIGHT_MODULE_PATH when it is outside this project.', { cause });
    return import(isAbsolute(target) ? pathToFileURL(target.endsWith('.mjs') || target.endsWith('.js') ? target : `${target}/index.mjs`).href : target);
  }
}
export function fixtureUrl(value, allowedPaths) {
  const url = new URL(value);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Browser tests use local synthetic fixtures only.');
  assert.ok(allowedPaths.includes(url.pathname), `Unexpected synthetic fixture path: ${url.pathname}`);
  return url;
}
export async function launchBrowser() {
  const { chromium } = await loadBrowserRuntime();
  return chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
}
export async function blockExternalRequests(context, external) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    external.push(url.origin); return route.abort();
  });
}
