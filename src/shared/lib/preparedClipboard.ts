/** Start copying during the click gesture, then supply text after its sources are saved. */
export async function copyPreparedText(prepare: () => Promise<string | null>): Promise<{ value: string; copied: boolean } | null> {
  const prepared = prepare();
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
  let copied: Promise<boolean>;
  if (clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const content = prepared.then(value => {
      // A failed/cancelled publication must leave the clipboard untouched.
      if (value === null) throw new Error('Copy preparation was cancelled.');
      return new Blob([value], { type: 'text/plain' });
    });
    // A browser may reject the write before consuming the promised content.
    void content.catch(() => {});
    try {
      copied = clipboard.write([new ClipboardItem({ 'text/plain': content })]).then(() => true, () => false);
    } catch {
      copied = Promise.resolve(false);
    }
  } else {
    // Older browsers still support direct text writes; the UI offers a fresh-click retry.
    copied = prepared.then(async value => {
      if (value === null || !clipboard?.writeText) return false;
      await clipboard.writeText(value);
      return true;
    }).catch(() => false);
  }
  const value = await prepared;
  return value === null ? null : { value, copied: await copied };
}
